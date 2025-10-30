import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { readParquet } from 'parquet-wasm';
import { tableFromIPC } from 'apache-arrow';
import pako from 'pako';
import Papa from 'papaparse';

// Create separate S3 client for Ookla data (public bucket, no credentials needed)
const ooklaS3Client = new S3Client({
  region: 'us-west-2',
  credentials: {
    accessKeyId: process.env.REACT_APP_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.REACT_APP_AWS_SECRET_ACCESS_KEY,
    sessionToken: process.env.REACT_APP_AWS_SESSION_TOKEN,
  }
});

const CONNECTIVITY_BUCKET = 'ookla-open-data';

let wasmInitialized = false;
const initializeWasm = async () => {
  if (!wasmInitialized) {
    try {
      const { default: init } = await import('parquet-wasm');
      await init();
      wasmInitialized = true;
      console.log('[Parquet] WASM initialized');
    } catch (error) {
      console.error('[Parquet] WASM init failed:', error);
      throw error;
    }
  }
};

// Helper to yield to the event loop
const yieldToEventLoop = () => new Promise(resolve => setTimeout(resolve, 0));

const streamToArrayBuffer = async (stream) => {
  const reader = stream.getReader();
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result.buffer;
};

/**
 * Get quarters from a list of months
 */
function getQuarters(months) {
  const quarters = new Set();
  for (const month of months) {
    const [year, monthNum] = month.split('-').map(Number);
    const quarter = Math.floor((monthNum - 1) / 3) + 1;
    quarters.add(`${year}-Q${quarter}`);
  }
  return Array.from(quarters).sort();
}

/**
 * Get polygon bounds from GeoJSON-like boundary
 */
function getPolygonBounds(boundary) {
    try {
      let geojson = boundary;
      if (typeof boundary === 'string') {
        try { geojson = JSON.parse(boundary); } catch (e) {}
      }
  
      let coordinates = [];
      if (geojson && geojson.type === 'Polygon') coordinates = geojson.coordinates;
      else if (geojson && geojson.type === 'MultiPolygon') coordinates = geojson.coordinates[0];
      else if (typeof geojson === 'string') {
        const m = geojson.match(/POLYGON\s*\(\s*\(\s*(.+?)\s*\)\s*\)/i);
        if (!m) throw new Error('WKT not recognized');
        coordinates = [m[1].split(',').map(p => p.trim().split(/\s+/).map(Number))];
      } else throw new Error('Invalid');
  
      const lons = coordinates[0].map(c => c[0]).filter(n => !isNaN(n));
      const lats = coordinates[0].map(c => c[1]).filter(n => !isNaN(n));
      return { minLon: Math.min(...lons), minLat: Math.min(...lats), maxLon: Math.max(...lons), maxLat: Math.max(...lats) };
    } catch (error) {
      console.error('Error parsing polygon bounds:', error.message);
      console.error('Boundary:', boundary);
      return { minLon: 0, minLat: 0, maxLon: 0, maxLat: 0 };
    }
  }

/**
 * Check if a point is within bounds
 */
function isPointInBounds(lon, lat, bounds) {
  return lon >= bounds.minLon && lon <= bounds.maxLon &&
         lat >= bounds.minLat && lat <= bounds.maxLat;
}

/**
 * Read parquet file from S3 using columnar approach for faster filtering
 */
async function readParquetFromS3(bucket, key, bounds, onProgress) {
    try {
      await initializeWasm();
      
      await yieldToEventLoop();
  
      console.log(`[Parquet] Fetching ${key}...`);
      const command = new GetObjectCommand({ Bucket: bucket, Key: key });
      const response = await ooklaS3Client.send(command); // Use Ookla client
  
      if (!response.Body) {
        console.warn(`[Parquet] No body in S3 response for ${key}`);
        return [];
      }
  
      const arrayBuffer = await streamToArrayBuffer(response.Body);
      const uint8Array = new Uint8Array(arrayBuffer);
  
      if (uint8Array.length < 4) {
        console.warn(`[Parquet] File too small: ${uint8Array.length} bytes`, key);
        return [];
      }
  
      const magic = new TextDecoder().decode(uint8Array.slice(0, 4));
      if (magic !== 'PAR1') {
        console.warn(`[Parquet] Invalid magic: ${magic}`, key);
        return [];
      }
  
      console.log(`[Parquet] Parsing ${(uint8Array.length / 1024 / 1024).toFixed(1)}MB from ${key}...`);
      
      await yieldToEventLoop();
      
      const wasmTable = readParquet(uint8Array);
      const ipcBytes = wasmTable.intoIPCStream();
      const arrowTable = tableFromIPC(ipcBytes);
  
      const numRows = arrowTable.numRows;
      console.log(`[Parquet] File has ${numRows.toLocaleString()} rows, filtering by bounds...`);
      
      if (numRows === 0) {
        return [];
      }
  
      // Get column references (columnar access is much faster)
      // Ookla schema: tile (string like "2023-01-01_performance_mobile_tiles"), quadkey, lat, lon, avg_d_kbps, avg_lat_ms, devices
      const latCol = arrowTable.getChild('tile_y');
      const lonCol = arrowTable.getChild('tile_x');
      const devicesCol = arrowTable.getChild('devices');
      const speedCol = arrowTable.getChild('avg_d_kbps');
      const latencyCol = arrowTable.getChild('avg_lat_ms');
      
      if (!latCol || !lonCol) {
        console.warn('[Parquet] Missing lat or lon columns');
        return [];
      }
  
      console.log('[Parquet] Filtering rows using columnar access...');
      const validRows = [];
      const CHUNK_SIZE = 50000; // Process 50k rows at a time

      // Track min/max coordinates seen for debugging
      let minLonSeen = Infinity, maxLonSeen = -Infinity;
      let minLatSeen = Infinity, maxLatSeen = -Infinity;
      let totalPointsChecked = 0;
      
      for (let startIdx = 0; startIdx < numRows; startIdx += CHUNK_SIZE) {
        const endIdx = Math.min(startIdx + CHUNK_SIZE, numRows);
        
        // Process this chunk with columnar access (much faster)
        for (let i = startIdx; i < endIdx; i++) {
          const lat = latCol.get(i);
          const lon = lonCol.get(i);
          
          // Track geographic extent
          if (lon != null && lat != null) {
            totalPointsChecked++;
            minLonSeen = Math.min(minLonSeen, lon);
            maxLonSeen = Math.max(maxLonSeen, lon);
            minLatSeen = Math.min(minLatSeen, lat);
            maxLatSeen = Math.max(maxLatSeen, lat);
          }
          
          // Quick bounds check first (fastest check)
          if (lon == null || lat == null || 
              !isPointInBounds(lon, lat, bounds)) {
            continue;
          }
          
          // Only get other columns if point is in bounds
          const devices = devicesCol?.get(i);
          const speed = speedCol?.get(i);
          const latency = latencyCol?.get(i);
          
          if (devices > 0 && speed > 0 && latency > 0) {
            validRows.push({
              tile_x: lon,
              tile_y: lat,
              devices: typeof devices === 'bigint' ? Number(devices) : devices,
              avg_d_kbps: typeof speed === 'bigint' ? Number(speed) : speed,
              avg_lat_ms: typeof latency === 'bigint' ? Number(latency) : latency
            });
          }
        }
        
        // Yield after each chunk
        await yieldToEventLoop();
        
        // Progress update every 100k rows
        if (onProgress && endIdx % 100000 === 0) {
          console.log(`[Parquet] Processed ${endIdx.toLocaleString()}/${numRows.toLocaleString()} rows, found ${validRows.length} valid tiles`);
        }
      }
  
      console.log(`[Parquet] Geographic extent of file: [${minLonSeen.toFixed(2)}, ${minLatSeen.toFixed(2)}] to [${maxLonSeen.toFixed(2)}, ${maxLatSeen.toFixed(2)}]`);
console.log(`[Parquet] Searched bounds: [${bounds.minLon.toFixed(2)}, ${bounds.minLat.toFixed(2)}] to [${bounds.maxLon.toFixed(2)}, ${bounds.maxLat.toFixed(2)}]`);
console.log(`[Parquet] Found ${validRows.length} valid tiles from ${numRows.toLocaleString()} rows (checked ${totalPointsChecked.toLocaleString()} points) in ${key}`);
      return validRows;
  
    } catch (error) {
      console.error(`[Parquet] Failed to read ${key}:`, error.message);
      return [];
    }
  }

/**
 * Calculate connectivity metrics for a city
 */
export async function calculateConnectivityMetrics(cityBoundary, months, onProgress) {
    console.log('[Connectivity] Starting calculation');
    console.log('[Connectivity] Months to process:', months);
    
    try {
      if (!cityBoundary) {
        console.warn('[Connectivity] No city boundary provided');
        return { speed: 0, latency: 0 };
      }
  
      await yieldToEventLoop();
  
      console.log('[Connectivity] Parsing city boundary...');
      const bounds = getPolygonBounds(cityBoundary);
      console.log('[Connectivity] City bounds:', bounds);
  
      // Add buffer to bounds
      const bufferedBounds = {
        minLon: bounds.minLon - 0.1,
        minLat: bounds.minLat - 0.1,
        maxLon: bounds.maxLon + 0.1,
        maxLat: bounds.maxLat + 0.1
      };
      console.log('[Connectivity] Buffered bounds:', bufferedBounds);
  
      const quarters = getQuarters(months);
      console.log('[Connectivity] Processing quarters:', quarters);
  
      let allTiles = [];
      let processedQuarters = 0;
  
      // Load connectivity data for each quarter
      // Ookla structure: parquet/performance/type=mobile/year=YYYY/quarter=Q/[files]
      for (const quarterStr of quarters) {
        console.log(`\n[Connectivity] Processing quarter: ${quarterStr}`);
        
        await yieldToEventLoop();
        
        try {
          const [year, quarter] = quarterStr.split('-Q');
          const prefix = `parquet/performance/type=mobile/year=${year}/quarter=${quarter}/`;
          
          console.log(`[Connectivity] Looking for data at: s3://${CONNECTIVITY_BUCKET}/${prefix}`);
          
          const listCommand = new ListObjectsV2Command({
            Bucket: CONNECTIVITY_BUCKET,
            Prefix: prefix,
            MaxKeys: 1000
          });
        
          console.log(`[Connectivity] Listing files in Ookla bucket with prefix: ${prefix}`);
          const listResult = await ooklaS3Client.send(listCommand);
          
          console.log(`[Connectivity] S3 returned ${(listResult.Contents || []).length} total objects`);
          
          const allParquetFiles = (listResult.Contents || [])
            .filter(obj => obj.Key.endsWith('.parquet'));
          
          console.log(`[Connectivity] Found ${allParquetFiles.length} parquet files`);
          if (allParquetFiles.length > 0) {
            console.log(`[Connectivity] First file: ${allParquetFiles[0].Key}`);
          }

          if (allParquetFiles.length === 0) {
            console.warn(`[Connectivity] No parquet files found in quarter ${quarterStr}`);
            continue;
          }

          // Process ALL files for better coverage (can limit later if needed)
          const parquetFiles = allParquetFiles;
          console.log(`[Connectivity] Processing ${parquetFiles.length} file(s) from this quarter`);
  
          for (let fileIdx = 0; fileIdx < parquetFiles.length; fileIdx++) {
            const file = parquetFiles[fileIdx];
            console.log(`[Connectivity] Processing: ${file.Key}`);

            await yieldToEventLoop();

            try {
              console.log(`[Connectivity] Searching for tiles in bounds: [${bufferedBounds.minLon.toFixed(2)}, ${bufferedBounds.minLat.toFixed(2)}] to [${bufferedBounds.maxLon.toFixed(2)}, ${bufferedBounds.maxLat.toFixed(2)}]`);
              
              const validRows = await readParquetFromS3(
                CONNECTIVITY_BUCKET, 
                file.Key, 
                bufferedBounds,
                onProgress
              );
              
              console.log(`[Connectivity] Added ${validRows.length} tiles from this file`);
              allTiles.push(...validRows);
              
            } catch (fileError) {
              console.warn(`[Connectivity] Error processing file ${file.Key}:`, fileError);
            }
          }
  
          processedQuarters++;
          console.log(`[Connectivity] Quarter ${quarterStr} complete (${processedQuarters}/${quarters.length})`);
          console.log(`[Connectivity] Running total: ${allTiles.length} tiles`);
          
          if (onProgress) {
            onProgress({
              current: processedQuarters,
              total: quarters.length,
              message: `Processed ${quarterStr}`
            });
          }
  
        } catch (quarterError) {
          console.warn(`[Connectivity] Error processing quarter ${quarterStr}:`, quarterError);
        }
      }
  
      console.log(`\n[Connectivity] Applying strict bounds filter...`);
      
      await yieldToEventLoop();
      
      const validTiles = allTiles.filter(tile => 
        tile.devices > 0 &&
        tile.avg_d_kbps > 0 &&
        tile.avg_lat_ms > 0
      );
  
      console.log(`[Connectivity] Final valid tiles: ${validTiles.length}`);
      
      if (validTiles.length === 0) {
        console.warn('[Connectivity] No valid connectivity tiles found in city bounds');
        console.warn('[Connectivity] City bounds:', bounds);
        console.warn('[Connectivity] Total tiles before filtering:', allTiles.length);
        return { speed: 0, latency: 0 };
      }
  
      console.log('[Connectivity] Calculating weighted averages...');
      const totalDevices = validTiles.reduce((sum, tile) => sum + tile.devices, 0);
      const weightedSpeed = validTiles.reduce((sum, tile) => 
        sum + (tile.avg_d_kbps * tile.devices), 0
      );
      const weightedLatency = validTiles.reduce((sum, tile) => 
        sum + (tile.avg_lat_ms * tile.devices), 0
      );
  
      const avgSpeed = weightedSpeed / totalDevices;
      const avgLatency = weightedLatency / totalDevices;
  
      console.log(`[Connectivity] ✓ Complete:`);
      console.log(`  Valid tiles: ${validTiles.length}`);
      console.log(`  Total devices: ${totalDevices.toLocaleString()}`);
      console.log(`  Avg speed: ${avgSpeed.toFixed(2)} kbps`);
      console.log(`  Avg latency: ${avgLatency.toFixed(2)} ms`);
  
      return {
        speed: avgSpeed,
        latency: avgLatency,
        coverage: null
      };
  
    } catch (error) {
      console.error('[Connectivity] Error calculating connectivity metrics:', error);
      console.error('[Connectivity] Error stack:', error.stack);
      return { speed: 0, latency: 0 };
    }
  }

  /**
 * Save connectivity results to S3 in both quarterly and summary formats
 */
export async function saveConnectivityResults(dataSource, results) {
  try {
    await initializeWasm();
    
    // Import S3Client and PutObjectCommand
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const { tableFromArrays, tableToIPC } = await import('apache-arrow');
    
    // Create S3 client for connectivity bucket
    const connectivityS3Client = new S3Client({
      region: process.env.REACT_APP_AWS_REGION,
      credentials: {
        accessKeyId: process.env.REACT_APP_AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.REACT_APP_AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.REACT_APP_AWS_SESSION_TOKEN,
      }
    });
    
    const CONNECTIVITY_RESULT_BUCKET = process.env.REACT_APP_S3_CONNECTIVITY_BUCKET_NAME || 'qoli-mobile-ping-connectivity-dev';
    
    console.log('[Connectivity] Saving results to S3...');
    console.log('[Connectivity] Results count:', results.length);
    console.log('[Connectivity] Data source:', dataSource);
    
    // Group results by date range for summary
    const resultsByDateRange = {};
    for (const result of results) {
      const dateRange = result.dateRange;
      if (!resultsByDateRange[dateRange]) {
        resultsByDateRange[dateRange] = [];
      }
      resultsByDateRange[dateRange].push(result);
    }
    
    // Save summary files (aggregated across date range)
    for (const [dateRange, cityResults] of Object.entries(resultsByDateRange)) {
      const summaryKey = `summary/${dateRange}/part-${Date.now()}-connectivity.csv.gz`;
      
      console.log(`[Connectivity] Saving summary to: ${summaryKey}`);
      
      const csvData = cityResults.map(r => ({
        city: r.city,
        province: r.province || '',
        country: r.country,
        speed: r.speed.toFixed(2),
        latency: r.latency.toFixed(2),
        coverage: r.coverage ? r.coverage.toFixed(2) : '0.00'
      }));
      
      const csv = Papa.unparse(csvData, {
        columns: ['city', 'province', 'country', 'speed', 'latency', 'coverage']
      });
      
      // Explicitly convert string to Uint8Array for pako
      const textEncoder = new TextEncoder();
      const csvBytes = textEncoder.encode(csv);
      const compressed = pako.gzip(csvBytes);
      
      // Verify gzip header
      console.log('[Connectivity] First two bytes:', compressed[0], compressed[1], '(should be 31, 139)');
      
      const putCommand = new PutObjectCommand({
        Bucket: CONNECTIVITY_RESULT_BUCKET,
        Key: summaryKey,
        Body: compressed,
        ContentType: 'application/gzip'
      });
      
      await connectivityS3Client.send(putCommand);
      console.log(`[Connectivity] ✓ Saved summary: ${summaryKey}`);
    }
    
    // Save quarterly parquet files per city
    for (const result of results) {
      const normalizedCity = result.city.toLowerCase().replace(/\s+/g, '_');
      const normalizedProvince = result.province ? result.province.toLowerCase().replace(/\s+/g, '_') : '';
      const normalizedCountry = result.country.toLowerCase().replace(/\s+/g, '_');
      
      // Parse date range to get quarters
      const [startDate, endDate] = result.dateRange.split('_to_');
      const quarters = getQuartersFromDateRange(startDate, endDate);
      
      // Save one parquet file per quarter
      for (const quarter of quarters) {
        const resultKey = normalizedProvince
          ? `results/country=${normalizedCountry}/province=${normalizedProvince}/city=${normalizedCity}/quarter=${quarter}/part-${Date.now()}.snappy.parquet`
          : `results/country=${normalizedCountry}/city=${normalizedCity}/quarter=${quarter}/part-${Date.now()}.snappy.parquet`;
        
        console.log(`[Connectivity] Saving quarterly result to: ${resultKey}`);
        
        // Create Arrow table with single row
        const table = tableFromArrays({
          city: [result.city],
          province: [result.province || ''],
          country: [result.country],
          quarter: [quarter],
          speed: [result.speed],
          latency: [result.latency],
          coverage: [result.coverage || 0]
        });
        
        // Convert to IPC format
        const ipcBuffer = tableToIPC(table, 'stream');
        
        // Convert to parquet with Snappy compression
        const { Table, writeParquet, WriterPropertiesBuilder, Compression } = await import('parquet-wasm');
        const wasmTable = Table.fromIPCStream(ipcBuffer);
        
        const writerProperties = new WriterPropertiesBuilder()
          .setCompression(Compression.SNAPPY)
          .build();
        
        const parquetBuffer = writeParquet(wasmTable, writerProperties);
        
        const putCommand = new PutObjectCommand({
          Bucket: CONNECTIVITY_RESULT_BUCKET,
          Key: resultKey,
          Body: parquetBuffer,
          ContentType: 'application/octet-stream'
        });
        
        await connectivityS3Client.send(putCommand);
        console.log(`[Connectivity] ✓ Saved quarterly parquet: ${resultKey}`);
      }
    }
    
    console.log('[Connectivity] ✓ All results saved successfully');
    return true;
    
  } catch (error) {
    console.error('[Connectivity] Error saving results:', error);
    throw error;
  }
}

/**
 * Get quarters from date range (helper function)
 */
function getQuartersFromDateRange(startMonth, endMonth) {
  const months = [];
  const [startYear, startMon] = startMonth.split('-').map(Number);
  const [endYear, endMon] = endMonth.split('-').map(Number);

  let currentYear = startYear;
  let currentMonth = startMon;

  while (currentYear < endYear || (currentYear === endYear && currentMonth <= endMon)) {
    months.push(`${currentYear}-${String(currentMonth).padStart(2, '0')}`);
    currentMonth++;
    if (currentMonth > 12) {
      currentMonth = 1;
      currentYear++;
    }
  }
  
  return getQuarters(months);
}

/**
 * Fetch mobile cellular subscriptions per 100 people from World Bank API
 */
async function fetchWorldBankCoverage(countryCode) {
  try {
    // World Bank API endpoint for mobile cellular subscriptions
    const url = `https://api.worldbank.org/v2/country/${countryCode}/indicator/IT.CEL.SETS.P2?format=json&per_page=20&mrnev=1`;
    
    console.log(`[Coverage] Fetching World Bank data for ${countryCode}...`);
    console.log(`[Coverage] URL: ${url}`);
    
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`[Coverage] World Bank API returned ${response.status} for ${countryCode}`);
      return 0;
    }
    
    const data = await response.json();
    
    console.log(`[Coverage] Raw API response for ${countryCode}:`, JSON.stringify(data, null, 2));
    
    // World Bank API returns [metadata, data_array]
    if (!data || !Array.isArray(data) || data.length < 2 || !Array.isArray(data[1]) || data[1].length === 0) {
      console.warn(`[Coverage] No data available for ${countryCode}`);
      return 0;
    }
    
    // Get the most recent non-null value
    const records = data[1];
    console.log(`[Coverage] Found ${records.length} records for ${countryCode}`);
    
    for (const record of records) {
      console.log(`[Coverage] ${countryCode} - Year ${record.date}: ${record.value}`);
      if (record.value !== null && !isNaN(record.value)) {
        console.log(`[Coverage] ${countryCode}: ${record.value}% (year: ${record.date})`);
        return parseFloat(record.value);
      }
    }
    
    console.warn(`[Coverage] No valid values found for ${countryCode}`);
    return 0;
    
  } catch (error) {
    console.error(`[Coverage] Error fetching World Bank data for ${countryCode}:`, error);
    return 0;
  }
}

/**
 * Map country names to ISO 3166-1 alpha-3 codes
 */
const COUNTRY_CODE_MAP = {
  'afghanistan': 'AFG',
  'albania': 'ALB',
  'algeria': 'DZA',
  'american samoa': 'ASM',
  'andorra': 'AND',
  'angola': 'AGO',
  'anguilla': 'AIA',
  'antarctica': 'ATA',
  'antigua and barbuda': 'ATG',
  'argentina': 'ARG',
  'armenia': 'ARM',
  'aruba': 'ABW',
  'australia': 'AUS',
  'austria': 'AUT',
  'azerbaijan': 'AZE',
  'bahamas': 'BHS',
  'bahrain': 'BHR',
  'bangladesh': 'BGD',
  'barbados': 'BRB',
  'belarus': 'BLR',
  'belgium': 'BEL',
  'belize': 'BLZ',
  'benin': 'BEN',
  'bermuda': 'BMU',
  'bhutan': 'BTN',
  'bolivia': 'BOL',
  'bonaire, sint eustatius and saba': 'BES',
  'bosnia and herzegovina': 'BIH',
  'botswana': 'BWA',
  'bouvet island': 'BVT',
  'brazil': 'BRA',
  'british indian ocean territory': 'IOT',
  'brunei darussalam': 'BRN',
  'bulgaria': 'BGR',
  'burkina faso': 'BFA',
  'burundi': 'BDI',
  'cabo verde': 'CPV',
  'cambodia': 'KHM',
  'cameroon': 'CMR',
  'canada': 'CAN',
  'cayman islands': 'CYM',
  'central african republic': 'CAF',
  'chad': 'TCD',
  'chile': 'CHL',
  'china': 'CHN',
  'christmas island': 'CXR',
  'cocos (keeling) islands': 'CCK',
  'colombia': 'COL',
  'comoros': 'COM',
  'congo (democratic republic of the)': 'COD',
  'congo': 'COG',
  'cook islands': 'COK',
  'costa rica': 'CRI',
  'croatia': 'HRV',
  'cuba': 'CUB',
  'curaçao': 'CUW',
  'cyprus': 'CYP',
  'czechia': 'CZE',
  "côte d'ivoire": 'CIV',
  'denmark': 'DNK',
  'djibouti': 'DJI',
  'dominica': 'DMA',
  'dominican republic': 'DOM',
  'ecuador': 'ECU',
  'egypt': 'EGY',
  'el salvador': 'SLV',
  'equatorial guinea': 'GNQ',
  'eritrea': 'ERI',
  'estonia': 'EST',
  'eswatini': 'SWZ',
  'ethiopia': 'ETH',
  'falkland islands (malvinas)': 'FLK',
  'faroe islands': 'FRO',
  'fiji': 'FJI',
  'finland': 'FIN',
  'france': 'FRA',
  'french guiana': 'GUF',
  'french polynesia': 'PYF',
  'french southern territories': 'ATF',
  'gabon': 'GAB',
  'gambia': 'GMB',
  'georgia': 'GEO',
  'germany': 'DEU',
  'ghana': 'GHA',
  'gibraltar': 'GIB',
  'greece': 'GRC',
  'greenland': 'GRL',
  'grenada': 'GRD',
  'guadeloupe': 'GLP',
  'guam': 'GUM',
  'guatemala': 'GTM',
  'guernsey': 'GGY',
  'guinea': 'GIN',
  'guinea-bissau': 'GNB',
  'guyana': 'GUY',
  'haiti': 'HTI',
  'heard island and mcdonald islands': 'HMD',
  'holy see': 'VAT',
  'honduras': 'HND',
  'hong kong': 'HKG',
  'hungary': 'HUN',
  'iceland': 'ISL',
  'india': 'IND',
  'indonesia': 'IDN',
  'iran': 'IRN',
  'iraq': 'IRQ',
  'ireland': 'IRL',
  'isle of man': 'IMN',
  'israel': 'ISR',
  'italy': 'ITA',
  'jamaica': 'JAM',
  'japan': 'JPN',
  'jersey': 'JEY',
  'jordan': 'JOR',
  'kazakhstan': 'KAZ',
  'kenya': 'KEN',
  'kiribati': 'KIR',
  "korea (democratic people's republic of)": 'PRK',
  'korea (republic of)': 'KOR',
  'kuwait': 'KWT',
  'kyrgyzstan': 'KGZ',
  "lao people's democratic republic": 'LAO',
  'latvia': 'LVA',
  'lebanon': 'LBN',
  'lesotho': 'LSO',
  'liberia': 'LBR',
  'libya': 'LBY',
  'liechtenstein': 'LIE',
  'lithuania': 'LTU',
  'luxembourg': 'LUX',
  'macao': 'MAC',
  'madagascar': 'MDG',
  'malawi': 'MWI',
  'malaysia': 'MYS',
  'maldives': 'MDV',
  'mali': 'MLI',
  'malta': 'MLT',
  'marshall islands': 'MHL',
  'martinique': 'MTQ',
  'mauritania': 'MRT',
  'mauritius': 'MUS',
  'mayotte': 'MYT',
  'mexico': 'MEX',
  'micronesia (federated states of)': 'FSM',
  'moldova': 'MDA',
  'monaco': 'MCO',
  'mongolia': 'MNG',
  'montenegro': 'MNE',
  'montserrat': 'MSR',
  'morocco': 'MAR',
  'mozambique': 'MOZ',
  'myanmar': 'MMR',
  'namibia': 'NAM',
  'nauru': 'NRU',
  'nepal': 'NPL',
  'netherlands': 'NLD',
  'new caledonia': 'NCL',
  'new zealand': 'NZL',
  'nicaragua': 'NIC',
  'niger': 'NER',
  'nigeria': 'NGA',
  'niue': 'NIU',
  'norfolk island': 'NFK',
  'northern mariana islands': 'MNP',
  'norway': 'NOR',
  'oman': 'OMN',
  'pakistan': 'PAK',
  'palau': 'PLW',
  'palestine': 'PSE',
  'panama': 'PAN',
  'papua new guinea': 'PNG',
  'paraguay': 'PRY',
  'peru': 'PER',
  'philippines': 'PHL',
  'pitcairn': 'PCN',
  'poland': 'POL',
  'portugal': 'PRT',
  'puerto rico': 'PRI',
  'qatar': 'QAT',
  'republic of north macedonia': 'MKD',
  'romania': 'ROU',
  'russia': 'RUS',
  'rwanda': 'RWA',
  'réunion': 'REU',
  'saint barthélemy': 'BLM',
  'saint helena, ascension and tristan da cunha': 'SHN',
  'saint kitts and nevis': 'KNA',
  'saint lucia': 'LCA',
  'saint martin (french part)': 'MAF',
  'saint pierre and miquelon': 'SPM',
  'saint vincent and the grenadines': 'VCT',
  'samoa': 'WSM',
  'san marino': 'SMR',
  'sao tome and principe': 'STP',
  'saudi arabia': 'SAU',
  'senegal': 'SEN',
  'serbia': 'SRB',
  'seychelles': 'SYC',
  'sierra leone': 'SLE',
  'singapore': 'SGP',
  'sint maarten (dutch part)': 'SXM',
  'slovakia': 'SVK',
  'slovenia': 'SVN',
  'solomon islands': 'SLB',
  'somalia': 'SOM',
  'south africa': 'ZAF',
  'south georgia and the south sandwich islands': 'SGS',
  'south sudan': 'SSD',
  'spain': 'ESP',
  'sri lanka': 'LKA',
  'sudan': 'SDN',
  'suriname': 'SUR',
  'svalbard and jan mayen': 'SJM',
  'sweden': 'SWE',
  'switzerland': 'CHE',
  'syrian arab republic': 'SYR',
  'taiwan': 'TWN',
  'tajikistan': 'TJK',
  'tanzania': 'TZA',
  'thailand': 'THA',
  'timor-leste': 'TLS',
  'togo': 'TGO',
  'tokelau': 'TKL',
  'tonga': 'TON',
  'trinidad and tobago': 'TTO',
  'tunisia': 'TUN',
  'turkey': 'TUR',
  'turkmenistan': 'TKM',
  'turks and caicos islands': 'TCA',
  'tuvalu': 'TUV',
  'uganda': 'UGA',
  'ukraine': 'UKR',
  'united arab emirates': 'ARE',
  'united kingdom': 'GBR',
  'united states': 'USA',
  'united states minor outlying islands': 'UMI',
  'uruguay': 'URY',
  'uzbekistan': 'UZB',
  'vanuatu': 'VUT',
  'venezuela': 'VEN',
  'viet nam': 'VNM',
  'virgin islands (british)': 'VGB',
  'virgin islands (u.s.)': 'VIR',
  'wallis and futuna': 'WLF',
  'western sahara': 'ESH',
  'yemen': 'YEM',
  'zambia': 'ZMB',
  'zimbabwe': 'ZWE',
  'åland islands': 'ALA'
};

/**
 * Get country code from country name
 */
function getCountryCode(countryName) {
  const normalized = countryName.toLowerCase().trim();
  return COUNTRY_CODE_MAP[normalized] || null;
}

export { fetchWorldBankCoverage, getCountryCode };
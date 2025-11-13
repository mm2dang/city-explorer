import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { GlueClient, StartJobRunCommand, GetJobRunCommand } from '@aws-sdk/client-glue';
import pako from 'pako';
import Papa from 'papaparse';

// Configure AWS clients
const s3Client = new S3Client({
  region: process.env.REACT_APP_AWS_REGION,
  credentials: {
    accessKeyId: process.env.REACT_APP_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.REACT_APP_AWS_SECRET_ACCESS_KEY,
    sessionToken: process.env.REACT_APP_AWS_SESSION_TOKEN,
  }
});

const glueClient = new GlueClient({
  region: process.env.REACT_APP_AWS_REGION,
  credentials: {
    accessKeyId: process.env.REACT_APP_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.REACT_APP_AWS_SECRET_ACCESS_KEY,
    sessionToken: process.env.REACT_APP_AWS_SESSION_TOKEN,
  }
});

const RESULT_BUCKET = process.env.REACT_APP_S3_RESULT_BUCKET_NAME;
const CONNECTIVITY_RESULT_BUCKET = process.env.REACT_APP_S3_CONNECTIVITY_BUCKET_NAME || 'qoli-mobile-ping-connectivity-dev';
const GLUE_JOB_NAME = 'calculate_indicators';

/**
 * Read and decompress a gzipped CSV file from S3
 */
async function readGzippedCsv(bucket, key) {
  try {
    console.log(`[CSV] Reading: s3://${bucket}/${key}`);
    
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key
    });

    const response = await s3Client.send(command);
    
    // Convert stream to buffer - browser environment
    let buffer;
    
    if (response.Body instanceof Blob) {
      // Modern browsers - Body is a Blob
      const arrayBuffer = await response.Body.arrayBuffer();
      buffer = new Uint8Array(arrayBuffer);
    } else if (response.Body.transformToByteArray) {
      // AWS SDK v3 browser environment helper
      buffer = await response.Body.transformToByteArray();
    } else {
      // Fallback - try to read as ReadableStream
      const reader = response.Body.getReader();
      const chunks = [];
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      
      // Concatenate chunks
      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
      buffer = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        buffer.set(chunk, offset);
        offset += chunk.length;
      }
    }
    
    console.log(`[CSV] Downloaded ${buffer.length} bytes`);
    
    // Decompress the gzipped content
    const decompressed = pako.ungzip(buffer, { to: 'string' });
    console.log(`[CSV] Decompressed to ${decompressed.length} characters`);
    console.log(`[CSV] First 200 chars:`, decompressed.substring(0, 200));
    
    // Parse CSV
    return new Promise((resolve, reject) => {
      Papa.parse(decompressed, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        transformHeader: (header) => {
          // Trim whitespace from headers
          return header.trim();
        },
        complete: (results) => {
          console.log(`[CSV] Parsed ${results.data.length} rows`);
          if (results.data.length > 0) {
            console.log(`[CSV] First row:`, results.data[0]);
            console.log(`[CSV] Headers:`, Object.keys(results.data[0]));
          }
          if (results.errors.length > 0) {
            console.warn(`[CSV] Parse errors:`, results.errors);
          }
          resolve(results.data);
        },
        error: (error) => {
          console.error(`[CSV] Parse error:`, error);
          reject(error);
        }
      });
    });
  } catch (error) {
    console.error(`[CSV] Error reading gzipped CSV ${key}:`, error);
    throw error;
  }
}

/**
 * Get available date ranges from S3 summary folder
 */
export async function getAvailableDateRanges(dataSource) {
  try {
    const prefix = `${dataSource}/summary/`;
    
    const command = new ListObjectsV2Command({
      Bucket: RESULT_BUCKET,
      Prefix: prefix,
      Delimiter: '/'
    });

    const result = await s3Client.send(command);
    
    // Extract date ranges from folder names
    const dateRanges = (result.CommonPrefixes || [])
      .map(prefix => {
        const parts = prefix.Prefix.split('/');
        return parts[parts.length - 2]; // Get the date range folder name
      })
      .filter(range => range.match(/^\d{4}-\d{2}_to_\d{4}-\d{2}$/))
      .sort()
      .reverse(); // Most recent first

    console.log(`Found ${dateRanges.length} date ranges for ${dataSource}:`, dateRanges);
    return dateRanges;
  } catch (error) {
    console.error('Error getting available date ranges:', error);
    throw error;
  }
}

/**
 * Get available date ranges from S3 connectivity folder
 */
export async function getAvailableConnectivityDateRanges(dataSource) {
  try {
    const prefix = `summary/`;
    
    const command = new ListObjectsV2Command({
      Bucket: CONNECTIVITY_RESULT_BUCKET,
      Prefix: prefix,
      Delimiter: '/'
    });

    const result = await s3Client.send(command);
    
    // Extract date ranges from folder names
    const dateRanges = (result.CommonPrefixes || [])
      .map(prefix => {
        const parts = prefix.Prefix.split('/');
        return parts[parts.length - 2]; // Get the date range folder name
      })
      .filter(range => range.match(/^\d{4}-\d{2}_to_\d{4}-\d{2}$/))
      .sort()
      .reverse(); // Most recent first

    console.log(`Found ${dateRanges.length} connectivity date ranges:`, dateRanges);
    return dateRanges;
  } catch (error) {
    console.error('Error getting connectivity date ranges:', error);
    return [];
  }
}

/**
 * Get summary data for all cities in a date range
 */
export async function getSummaryData(dataSource, dateRange) {
  try {
    const prefix = `${dataSource}/summary/${dateRange}/`;
    
    // List all CSV files in the date range folder
    const command = new ListObjectsV2Command({
      Bucket: RESULT_BUCKET,
      Prefix: prefix
    });

    const result = await s3Client.send(command);
    
    // Filter for CSV.gz files
    const csvFiles = (result.Contents || []).filter(obj => 
      obj.Key.endsWith('.csv.gz')
    );

    console.log(`Found ${csvFiles.length} CSV files in ${prefix}`);

    // Read and combine all CSV files
    let allData = [];
    for (const file of csvFiles) {
      try {
        const data = await readGzippedCsv(RESULT_BUCKET, file.Key);
        allData = allData.concat(data);
      } catch (error) {
        console.error(`Error reading file ${file.Key}:`, error);
      }
    }

    console.log(`Loaded ${allData.length} rows of summary data`);
    return allData;
  } catch (error) {
    console.error('Error getting summary data:', error);
    throw error;
  }
}

export async function getSummaryDataWithConnectivity(dataSource, dateRange, cities) {
  try {
    console.log(`[Summary] Loading data for ${dataSource}, ${dateRange}`);
    
    // Try to load Glue summary data, but don't fail if it doesn't exist
    let summaryData = [];
    try {
      summaryData = await getSummaryData(dataSource, dateRange);
      console.log(`[Summary] Loaded ${summaryData.length} rows from Glue results`);
    } catch (error) {
      console.log('[Summary] No Glue summary data found, will use connectivity-only data');
    }
    
    // Try to merge with connectivity results
    summaryData = await mergeSummaryWithConnectivity(summaryData, dataSource, dateRange);
    
    // If still no data, create skeleton data from connectivity results only
    if (summaryData.length === 0) {
      console.log('[Summary] Creating skeleton data from connectivity results');
      const connectivityResults = await loadConnectivityResults(dataSource, dateRange);
      
      if (connectivityResults.length === 0) {
        console.warn('[Summary] No data available from either source');
        return [];
      }
      
      summaryData = connectivityResults.map(r => ({
        city: r.city,
        province: r.province || '',
        country: r.country,
        out_at_night: null,
        leisure_dwell_time: null,
        cultural_visits: null,
        coverage: null,
        speed: r.speed,
        latency: r.latency
      }));
      
      console.log(`[Summary] Created ${summaryData.length} skeleton rows from connectivity data`);
    }

    console.log(`[Summary] Final data count: ${summaryData.length} rows`);
    return summaryData;
  } catch (error) {
    console.error('[Summary] Error getting summary data with connectivity:', error);
    throw error;
  }
}

/**
 * Get monthly indicator data for a specific city
 */
export async function getMonthlyIndicators(dataSource, country, province, city, dateRange) {
  try {
    // Parse date range to get start and end months
    const [startDate, endDate] = dateRange.split('_to_');
    const startMonth = startDate;
    const endMonth = endDate;

    // Generate list of months in range
    const months = generateMonthRange(startMonth, endMonth);
    
    // Normalize names for S3 paths
    const normalizedCountry = country.toLowerCase().replace(/\s+/g, '_');
    const normalizedProvince = province ? province.toLowerCase().replace(/\s+/g, '_') : '';
    const normalizedCity = city.toLowerCase().replace(/\s+/g, '_');

    const monthlyData = [];

    for (const month of months) {
      try {
        // Construct S3 path
        const prefix = normalizedProvince
          ? `${dataSource}/results/country=${normalizedCountry}/province=${normalizedProvince}/city=${normalizedCity}/month=${month}/`
          : `${dataSource}/results/country=${normalizedCountry}/city=${normalizedCity}/month=${month}/`;

        // List files in this month's folder
        const command = new ListObjectsV2Command({
          Bucket: RESULT_BUCKET,
          Prefix: prefix
        });

        const result = await s3Client.send(command);
        
        // Find parquet files
        const parquetFiles = (result.Contents || []).filter(obj => 
          obj.Key.endsWith('.parquet')
        );

        if (parquetFiles.length > 0) {
          console.log(`Found ${parquetFiles.length} parquet files for ${month}`);
          
          // Read the first parquet file
          try {
            const getCommand = new GetObjectCommand({
              Bucket: RESULT_BUCKET,
              Key: parquetFiles[0].Key
            });

            const response = await s3Client.send(getCommand);
            
            // Convert stream to buffer
            let buffer;
            if (response.Body instanceof Blob) {
              const arrayBuffer = await response.Body.arrayBuffer();
              buffer = new Uint8Array(arrayBuffer);
            } else if (response.Body.transformToByteArray) {
              buffer = await response.Body.transformToByteArray();
            } else {
              const reader = response.Body.getReader();
              const chunks = [];
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
              }
              const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
              buffer = new Uint8Array(totalLength);
              let offset = 0;
              for (const chunk of chunks) {
                buffer.set(chunk, offset);
                offset += chunk.length;
              }
            }

            // Use parquet-wasm to read the file
            const parquetWasm = await import('parquet-wasm');
            await parquetWasm.default(); // Initialize WASM
            
            const arrowTable = parquetWasm.readParquet(buffer);
            
            // Extract data from Arrow table
            const numRows = arrowTable.numRows;
            const numCols = arrowTable.numCols;
            
            if (numRows > 0) {
              const schema = arrowTable.schema;
              const row = {};
              
              for (let colIdx = 0; colIdx < numCols; colIdx++) {
                const column = arrowTable.getChildAt(colIdx);
                const fieldName = schema.fields[colIdx].name;
                row[fieldName] = column.get(0);
              }
              
              monthlyData.push({
                month,
                out_at_night: row.out_at_night || 0,
                leisure_dwell_time: row.leisure_dwell_time || 0,
                cultural_visits: row.cultural_visits || 0,
                coverage: row.coverage || 0,
                speed: row.speed || 0,
                latency: row.latency || 0
              });
            }
          } catch (parquetError) {
            console.error(`Error reading parquet file for ${month}:`, parquetError);
            // Fallback to summary data
            const summaryData = await getSummaryData(dataSource, dateRange);
            const cityData = summaryData.find(row => 
              row.city.toLowerCase() === city.toLowerCase() &&
              row.country.toLowerCase() === country.toLowerCase() &&
              (!province || row.province.toLowerCase() === province.toLowerCase())
            );

            if (cityData) {
              monthlyData.push({
                month,
                out_at_night: cityData.out_at_night,
                leisure_dwell_time: cityData.leisure_dwell_time,
                cultural_visits: cityData.cultural_visits,
                coverage: cityData.coverage,
                speed: cityData.speed,
                latency: cityData.latency
              });
            }
          }
        }
      } catch (error) {
        console.error(`Error loading data for month ${month}:`, error);
      }
    }

    console.log(`Loaded ${monthlyData.length} months of data for ${city}`);
    return monthlyData;
  } catch (error) {
    console.error('Error getting monthly indicators:', error);
    throw error;
  }
}

/**
 * Generate array of months between start and end (inclusive)
 */
function generateMonthRange(startMonth, endMonth) {
  const months = [];
  const [startYear, startMon] = startMonth.split('-').map(Number);
  const [endYear, endMon] = endMonth.split('-').map(Number);

  let currentYear = startYear;
  let currentMonth = startMon;

  while (currentYear < endYear || (currentYear === endYear && currentMonth <= endMon)) {
    const monthStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
    months.push(monthStr);

    currentMonth++;
    if (currentMonth > 12) {
      currentMonth = 1;
      currentYear++;
    }
  }

  return months;
}

/**
 * Trigger the Glue job to calculate indicators
 */
export async function triggerGlueJobWithParams(parameters) {
  try {
    const command = new StartJobRunCommand({
      JobName: parameters.JOB_NAME,
      Arguments: {
        '--CITY': parameters.CITY,
        '--PROVINCE': parameters.PROVINCE,
        '--COUNTRY': parameters.COUNTRY,
        '--START_MONTH': parameters.START_MONTH,
        '--END_MONTH': parameters.END_MONTH,
        '--USE_OSM': parameters.USE_OSM
      }
    });

    const result = await glueClient.send(command);
    console.log('Started Glue job:', result.JobRunId);
    return result;
  } catch (error) {
    console.error('Error triggering Glue job:', error);
    throw error;
  }
}

/**
 * Get the status of a Glue job run
 */
export async function getGlueJobStatus(jobRunId) {
  try {
    const command = new GetJobRunCommand({
      JobName: GLUE_JOB_NAME,
      RunId: jobRunId
    });

    const result = await glueClient.send(command);
    const jobRun = result.JobRun;

    return {
      state: jobRun.JobRunState,
      startedOn: jobRun.StartedOn,
      completedOn: jobRun.CompletedOn,
      executionTime: jobRun.ExecutionTime,
      errorMessage: jobRun.ErrorMessage,
      progress: calculateProgress(jobRun),
      message: getStatusMessage(jobRun)
    };
  } catch (error) {
    console.error('Error getting Glue job status:', error);
    throw error;
  }
}

/**
 * Calculate progress percentage from job run state
 */
function calculateProgress(jobRun) {
  const state = jobRun.JobRunState;
  
  switch (state) {
    case 'STARTING':
      return 10;
    case 'RUNNING':
      // Estimate progress based on execution time if available
      if (jobRun.ExecutionTime && jobRun.Timeout) {
        return Math.min(90, 10 + (jobRun.ExecutionTime / jobRun.Timeout) * 80);
      }
      return 50;
    case 'SUCCEEDED':
      return 100;
    case 'FAILED':
    case 'STOPPED':
      return 0;
    default:
      return 0;
  }
}

/**
 * Get human-readable status message
 */
function getStatusMessage(jobRun) {
  const state = jobRun.JobRunState;
  
  switch (state) {
    case 'STARTING':
      return 'Initializing calculation job...';
    case 'RUNNING':
      if (jobRun.ExecutionTime) {
        const minutes = Math.floor(jobRun.ExecutionTime / 60);
        return `Processing data... (${minutes} min elapsed)`;
      }
      return 'Processing data...';
    case 'SUCCEEDED':
      return 'Calculation completed successfully!';
    case 'FAILED':
      return jobRun.ErrorMessage || 'Calculation failed';
    case 'STOPPED':
      return 'Calculation was stopped';
    default:
      return state;
  }
}

/**
 * Load connectivity results from S3
 */
export async function loadConnectivityResults(dataSource, dateRange) {
  try {
    const prefix = `summary/${dateRange}/`;
    
    console.log(`[Connectivity] Loading from: s3://${CONNECTIVITY_RESULT_BUCKET}/${prefix}`);
    
    // List all CSV files in the date range folder
    const listCommand = new ListObjectsV2Command({
      Bucket: CONNECTIVITY_RESULT_BUCKET,
      Prefix: prefix
    });

    const result = await s3Client.send(listCommand);
    
    console.log(`[Connectivity] S3 list returned ${(result.Contents || []).length} objects`);
    
    // Filter for CSV.gz files
    const csvFiles = (result.Contents || []).filter(obj => 
      obj.Key.endsWith('.csv.gz') || obj.Key.endsWith('-connectivity.csv.gz')
    );

    console.log(`[Connectivity] Found ${csvFiles.length} connectivity CSV files:`);
    csvFiles.forEach(file => console.log(`  - ${file.Key} (${file.Size} bytes)`));

    if (csvFiles.length === 0) {
      console.warn(`[Connectivity] No CSV files found in ${prefix}`);
      return [];
    }

    // Read and combine all CSV files
    let allData = [];
    for (const file of csvFiles) {
      try {
        console.log(`[Connectivity] Reading file: ${file.Key}`);
        const data = await readGzippedCsv(CONNECTIVITY_RESULT_BUCKET, file.Key);
        console.log(`[Connectivity] File contained ${data.length} rows`);
        
        // Validate and normalize the data
        const validData = data
          .filter(row => {
            // Check if row has required fields
            const hasRequiredFields = row.city && row.country;
            if (!hasRequiredFields) {
              console.warn(`[Connectivity] Skipping row with missing fields:`, row);
            }
            return hasRequiredFields;
          })
          .map(row => ({
            city: String(row.city || '').trim(),
            province: String(row.province || '').trim(),
            country: String(row.country || '').trim(),
            speed: parseFloat(row.speed) || 0,
            latency: parseFloat(row.latency) || 0,
            coverage: parseFloat(row.coverage) || 0 // Include coverage field
          }));
        
        console.log(`[Connectivity] After validation: ${validData.length} valid rows`);
        allData = allData.concat(validData);
      } catch (error) {
        console.error(`[Connectivity] Error reading file ${file.Key}:`, error);
      }
    }

    console.log(`[Connectivity] Total loaded: ${allData.length} connectivity results`);
    if (allData.length > 0) {
      console.log(`[Connectivity] Sample data:`, allData.slice(0, 3));
    }
    return allData;
    
  } catch (error) {
    if (error.name === 'NoSuchKey' || error.Code === 'NoSuchKey') {
      console.log(`[Connectivity] No connectivity results found for ${dateRange}`);
      return [];
    }
    console.error('[Connectivity] Error loading connectivity results:', error);
    return [];
  }
}

/**
 * Merge connectivity results with summary data (FULL JOIN)
 */
export async function mergeSummaryWithConnectivity(summaryData, dataSource, dateRange) {
  try {
    const connectivityResults = await loadConnectivityResults(dataSource, dateRange);
    
    console.log(`[Connectivity] Performing full join: ${summaryData.length} summary rows + ${connectivityResults.length} connectivity rows`);
    
    // Create lookup map for connectivity data
    const connectivityMap = new Map();
    for (const result of connectivityResults) {
      const city = String(result.city || '').toLowerCase().trim();
      const province = String(result.province || '').toLowerCase().trim();
      const country = String(result.country || '').toLowerCase().trim();

      if (!city || !country) {
        console.warn('[Connectivity] Skipping result with missing city/country:', result);
        continue;
      }

      // Create multiple lookup keys for flexibility
      const keys = [
        `${city}|${province}|${country}`,
        `${city}||${country}`, // Without province
        `${city}|${country}` // Alternative format
      ];
      
      const connectivityValue = {
        speed: parseFloat(result.speed) || 0,
        latency: parseFloat(result.latency) || 0,
        coverage: parseFloat(result.coverage) || 0, // Include coverage
        city: result.city,
        province: result.province,
        country: result.country
      };
      
      keys.forEach(key => connectivityMap.set(key, connectivityValue));
    }

    console.log(`[Connectivity] Created ${connectivityMap.size} lookup entries`);

    // Track which connectivity entries were merged
    const mergedConnectivityKeys = new Set();

    // Merge connectivity data into summary data
    let mergedCount = 0;
    const mergedData = summaryData.map(row => {
      const city = String(row.city || '').toLowerCase().trim();
      const province = String(row.province || '').toLowerCase().trim();
      const country = String(row.country || '').toLowerCase().trim();

      if (!city || !country) {
        console.warn('[Connectivity] Skipping summary row with missing city/country:', row);
        return row;
      }

      // Try multiple lookup keys
      const lookupKeys = [
        `${city}|${province}|${country}`,
        `${city}||${country}`,
        `${city}|${country}`
      ];
      
      let connectivity = null;
      let matchedKey = null;
      for (const key of lookupKeys) {
        connectivity = connectivityMap.get(key);
        if (connectivity) {
          matchedKey = key;
          break;
        }
      }

      if (connectivity) {
        mergedCount++;
        mergedConnectivityKeys.add(matchedKey);
        console.log(`[Connectivity] ✓ Merged data for ${row.city}: speed=${connectivity.speed.toFixed(2)}, latency=${connectivity.latency.toFixed(2)}, coverage=${connectivity.coverage.toFixed(2)}`);
        return { 
          ...row, 
          speed: connectivity.speed, 
          latency: connectivity.latency,
          coverage: connectivity.coverage // Override with connectivity coverage
        };
      } else {
        console.log(`[Connectivity] ✗ No connectivity match for ${row.city}, keeping row with existing coverage`);
        return {
          ...row,
          speed: null,
          latency: null,
          coverage: row.coverage || null // Keep existing coverage if available
        };
      }
    });
    
    // Add connectivity-only rows (those not in summary data)
    const connectivityOnlyRows = [];
    for (const [key, connectivity] of connectivityMap.entries()) {
      if (!mergedConnectivityKeys.has(key)) {
        // This connectivity result wasn't matched with any summary row
        // Only add it once per unique city (skip alternative key formats)
        const primaryKey = `${connectivity.city.toLowerCase().trim()}|${String(connectivity.province || '').toLowerCase().trim()}|${connectivity.country.toLowerCase().trim()}`;
        if (key === primaryKey) {
          console.log(`[Connectivity] Adding connectivity-only row for ${connectivity.city}`);
          connectivityOnlyRows.push({
            city: connectivity.city,
            province: connectivity.province || '',
            country: connectivity.country,
            out_at_night: null,
            leisure_dwell_time: null,
            cultural_visits: null,
            coverage: connectivity.coverage, // Use coverage from connectivity
            speed: connectivity.speed,
            latency: connectivity.latency
          });
        }
      }
    }
    
    const finalData = [...mergedData, ...connectivityOnlyRows];
    
    console.log(`[Connectivity] Full join complete:`);
    console.log(`  - Summary rows with connectivity: ${mergedCount}`);
    console.log(`  - Summary rows without connectivity: ${summaryData.length - mergedCount}`);
    console.log(`  - Connectivity-only rows: ${connectivityOnlyRows.length}`);
    console.log(`  - Total rows: ${finalData.length}`);
    
    return finalData;
  } catch (error) {
    console.error('[Connectivity] Error merging connectivity data:', error);
    return summaryData;
  }
}

/**
 * Get monthly indicator data for a specific city and indicator
 */
export async function getMonthlyIndicatorData(dataSource, country, province, city, indicatorKey, dateRange) {
  try {
    console.log(`[TimeSeries] Starting monthly data fetch:`, {
      dataSource,
      country,
      province,
      city,
      indicatorKey,
      dateRange
    });
    
    const [startDate, endDate] = dateRange.split('_to_');
    const months = generateMonthRange(startDate, endDate);
    
    const normalizedCountry = country.toLowerCase().replace(/\s+/g, '_');
    const normalizedProvince = province ? province.toLowerCase().replace(/\s+/g, '_') : '';
    const normalizedCity = city.toLowerCase().replace(/\s+/g, '_');

    const monthlyData = [];

    for (const month of months) {
      try {
        const prefix = normalizedProvince
          ? `${dataSource}/results/country=${normalizedCountry}/province=${normalizedProvince}/city=${normalizedCity}/month=${month}/`
          : `${dataSource}/results/country=${normalizedCountry}/city=${normalizedCity}/month=${month}/`;

        console.log(`[TimeSeries] Searching path: s3://${RESULT_BUCKET}/${prefix}`);

        const command = new ListObjectsV2Command({
          Bucket: RESULT_BUCKET,
          Prefix: prefix
        });

        const result = await s3Client.send(command);
        const parquetFiles = (result.Contents || []).filter(obj => 
          obj.Key.endsWith('.parquet') || obj.Key.endsWith('.snappy.parquet')
        );

        console.log(`[TimeSeries] Found ${parquetFiles.length} parquet files for ${month}`);

        if (parquetFiles.length > 0) {
          const getCommand = new GetObjectCommand({
            Bucket: RESULT_BUCKET,
            Key: parquetFiles[0].Key
          });

          console.log(`[TimeSeries] Reading file: ${parquetFiles[0].Key}`);
          const response = await s3Client.send(getCommand);
          let buffer;
          
          if (response.Body instanceof Blob) {
            const arrayBuffer = await response.Body.arrayBuffer();
            buffer = new Uint8Array(arrayBuffer);
          } else if (response.Body.transformToByteArray) {
            buffer = await response.Body.transformToByteArray();
          } else {
            const reader = response.Body.getReader();
            const chunks = [];
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value);
            }
            const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
            buffer = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
              buffer.set(chunk, offset);
              offset += chunk.length;
            }
          }

          console.log(`[TimeSeries] Buffer size: ${buffer.length} bytes`);

          // Initialize parquet-wasm if needed
          const parquetWasm = await import('parquet-wasm');
          if (!window.parquetWasmInitialized) {
            await parquetWasm.default();
            window.parquetWasmInitialized = true;
          }
          
          // Read parquet and convert to Arrow IPC
          const wasmTable = parquetWasm.readParquet(buffer);
          const ipcBytes = wasmTable.intoIPCStream();
          
          // Import Apache Arrow
          const { tableFromIPC } = await import('apache-arrow');
          const arrowTable = tableFromIPC(ipcBytes);
          
          const numRows = arrowTable.numRows;
          const numCols = arrowTable.numCols;
          
          console.log(`[TimeSeries] Parquet has ${numRows} rows, ${numCols} columns`);
          
          if (numRows > 0) {
            const schema = arrowTable.schema;
            const fieldNames = schema.fields.map(f => f.name);
            console.log(`[TimeSeries] Column names:`, fieldNames);
            
            const fieldIndex = schema.fields.findIndex(f => f.name === indicatorKey);
            
            if (fieldIndex === -1) {
              console.warn(`[TimeSeries] Column '${indicatorKey}' not found. Available columns:`, fieldNames);
              continue;
            }
            
            console.log(`[TimeSeries] Found column '${indicatorKey}' at index ${fieldIndex}`);
            
            const column = arrowTable.getChildAt(fieldIndex);
            const value = column.get(0);
            
            console.log(`[TimeSeries] Raw value for ${month}:`, value, `(type: ${typeof value})`);
            
            if (value != null && !isNaN(value)) {
              const numericValue = typeof value === 'bigint' ? Number(value) : parseFloat(value);
              console.log(`[TimeSeries] ✓ Added value for ${month}: ${numericValue}`);
              monthlyData.push({
                month,
                value: numericValue
              });
            } else {
              console.warn(`[TimeSeries] Invalid value for ${month}:`, value);
            }
          }
        }
      } catch (monthError) {
        console.error(`[TimeSeries] Error loading data for month ${month}:`, monthError);
      }
    }

    console.log(`[TimeSeries] ✓ Loaded ${monthlyData.length} months of ${indicatorKey} data for ${city}`);
    console.log(`[TimeSeries] Data:`, monthlyData);
    return monthlyData;
  } catch (error) {
    console.error('[TimeSeries] Error getting monthly indicator data:', error);
    throw error;
  }
}

/**
 * Get quarterly connectivity data for a specific city and indicator
 */
export async function getQuarterlyConnectivityData(country, province, city, indicatorKey, dateRange) {
  try {
    console.log(`[TimeSeries] Starting quarterly connectivity data fetch:`, {
      country,
      province,
      city,
      indicatorKey,
      dateRange
    });
    
    const [startDate, endDate] = dateRange.split('_to_');
    const months = generateMonthRange(startDate, endDate);
    const quarters = getQuarters(months);
    
    const normalizedCountry = country.toLowerCase().replace(/\s+/g, '_');
    const normalizedProvince = province ? province.toLowerCase().replace(/\s+/g, '_') : '';
    const normalizedCity = city.toLowerCase().replace(/\s+/g, '_');

    const quarterlyData = [];

    for (const quarter of quarters) {
      try {
        const prefix = normalizedProvince
          ? `results/country=${normalizedCountry}/province=${normalizedProvince}/city=${normalizedCity}/quarter=${quarter}/`
          : `results/country=${normalizedCountry}/city=${normalizedCity}/quarter=${quarter}/`;

        console.log(`[TimeSeries] Searching path: s3://${CONNECTIVITY_RESULT_BUCKET}/${prefix}`);

        const command = new ListObjectsV2Command({
          Bucket: CONNECTIVITY_RESULT_BUCKET,
          Prefix: prefix
        });

        const result = await s3Client.send(command);
        const parquetFiles = (result.Contents || []).filter(obj => 
          obj.Key.endsWith('.parquet') || obj.Key.endsWith('.snappy.parquet')
        );

        console.log(`[TimeSeries] Found ${parquetFiles.length} parquet files for ${quarter}`);

        if (parquetFiles.length > 0) {
          const getCommand = new GetObjectCommand({
            Bucket: CONNECTIVITY_RESULT_BUCKET,
            Key: parquetFiles[0].Key
          });

          console.log(`[TimeSeries] Reading file: ${parquetFiles[0].Key}`);
          const response = await s3Client.send(getCommand);
          let buffer;
          
          if (response.Body instanceof Blob) {
            const arrayBuffer = await response.Body.arrayBuffer();
            buffer = new Uint8Array(arrayBuffer);
          } else if (response.Body.transformToByteArray) {
            buffer = await response.Body.transformToByteArray();
          } else {
            const reader = response.Body.getReader();
            const chunks = [];
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value);
            }
            const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
            buffer = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
              buffer.set(chunk, offset);
              offset += chunk.length;
            }
          }

          console.log(`[TimeSeries] Buffer size: ${buffer.length} bytes`);

          // Initialize parquet-wasm if needed
          const parquetWasm = await import('parquet-wasm');
          if (!window.parquetWasmInitialized) {
            await parquetWasm.default();
            window.parquetWasmInitialized = true;
          }
          
          // Read parquet and convert to Arrow IPC
          const wasmTable = parquetWasm.readParquet(buffer);
          const ipcBytes = wasmTable.intoIPCStream();
          
          // Import Apache Arrow
          const { tableFromIPC } = await import('apache-arrow');
          const arrowTable = tableFromIPC(ipcBytes);
          
          const numRows = arrowTable.numRows;
          const numCols = arrowTable.numCols;
          
          console.log(`[TimeSeries] Parquet has ${numRows} rows, ${numCols} columns`);
          
          if (numRows > 0) {
            const schema = arrowTable.schema;
            const fieldNames = schema.fields.map(f => f.name);
            console.log(`[TimeSeries] Column names:`, fieldNames);
            
            const fieldIndex = schema.fields.findIndex(f => f.name === indicatorKey);
            
            if (fieldIndex === -1) {
              console.warn(`[TimeSeries] Column '${indicatorKey}' not found. Available columns:`, fieldNames);
              continue;
            }
            
            console.log(`[TimeSeries] Found column '${indicatorKey}' at index ${fieldIndex}`);
            
            const column = arrowTable.getChildAt(fieldIndex);
            const value = column.get(0);
            
            console.log(`[TimeSeries] Raw value for ${quarter}:`, value, `(type: ${typeof value})`);
            
            if (value != null && !isNaN(value)) {
              const numericValue = typeof value === 'bigint' ? Number(value) : parseFloat(value);
              console.log(`[TimeSeries] ✓ Added value for ${quarter}: ${numericValue}`);
              quarterlyData.push({
                quarter,
                value: numericValue
              });
            } else {
              console.warn(`[TimeSeries] Invalid value for ${quarter}:`, value);
            }
          }
        }
      } catch (quarterError) {
        console.error(`[TimeSeries] Error loading data for quarter ${quarter}:`, quarterError);
      }
    }

    console.log(`[TimeSeries] ✓ Loaded ${quarterlyData.length} quarters of ${indicatorKey} data for ${city}`);
    console.log(`[TimeSeries] Data:`, quarterlyData);
    return quarterlyData;
  } catch (error) {
    console.error('[TimeSeries] Error getting quarterly connectivity data:', error);
    throw error;
  }
}

/**
 * Get quarters from a list of months
 */
export function getQuarters(months) {
  const quarters = new Set();
  for (const month of months) {
    const [year, monthNum] = month.split('-').map(Number);
    const quarter = Math.floor((monthNum - 1) / 3) + 1;
    quarters.add(`${year}-Q${quarter}`);
  }
  return Array.from(quarters).sort();
}

/**
 * Check calculation status for a specific city
 * Returns: 'calculated', 'not_calculated', 'connectivity_only', 'mobile_ping_only'
 */
export async function getCityCalculationStatus(city, province, country, dateRange, dataSource) {
  try {
    console.log(`[Status] Checking calculation status for ${city}, ${province}, ${country} in ${dateRange}`);

    // Check for mobile ping data (Glue results)
    let hasMobilePingData = false;
    try {
      const prefix = `${dataSource}/summary/${dateRange}/`;

      const listCommand = new ListObjectsV2Command({
        Bucket: RESULT_BUCKET,
        Prefix: prefix
      });

      const result = await s3Client.send(listCommand);
      const csvFiles = (result.Contents || []).filter(obj => obj.Key.endsWith('.csv.gz'));

      // Check if any summary file contains this city
      for (const file of csvFiles) {
        const data = await readGzippedCsv(RESULT_BUCKET, file.Key);
        const cityData = data.find(row => {
          const rowCity = String(row.city || '').toLowerCase().trim();
          const rowProvince = String(row.province || '').toLowerCase().trim();
          const rowCountry = String(row.country || '').toLowerCase().trim();
          
          const matchesCity = rowCity === city.toLowerCase().trim();
          const matchesCountry = rowCountry === country.toLowerCase().trim();
          const matchesProvince = !province || rowProvince === province.toLowerCase().trim();
          
          return matchesCity && matchesCountry && matchesProvince;
        });

        if (cityData) {
          // Check if any mobile ping indicators have values
          const hasOutAtNight = cityData.out_at_night != null && !isNaN(cityData.out_at_night);
          const hasLeisure = cityData.leisure_dwell_time != null && !isNaN(cityData.leisure_dwell_time);
          const hasCultural = cityData.cultural_visits != null && !isNaN(cityData.cultural_visits);
          
          hasMobilePingData = hasOutAtNight || hasLeisure || hasCultural;
          if (hasMobilePingData) {
            console.log(`[Status] Found mobile ping data for ${city}`);
            break;
          }
        }
      }
    } catch (error) {
      console.log(`[Status] No mobile ping data found for ${city}:`, error.message);
    }

    // Check for connectivity data
    let hasConnectivityData = false;
    try {
      const prefix = `summary/${dateRange}/`;

      const listCommand = new ListObjectsV2Command({
        Bucket: CONNECTIVITY_RESULT_BUCKET,
        Prefix: prefix
      });

      const result = await s3Client.send(listCommand);
      const csvFiles = (result.Contents || []).filter(obj => 
        obj.Key.endsWith('.csv.gz') || obj.Key.endsWith('-connectivity.csv.gz')
      );

      // Check if any connectivity file contains this city
      for (const file of csvFiles) {
        const data = await readGzippedCsv(CONNECTIVITY_RESULT_BUCKET, file.Key);
        const cityData = data.find(row => {
          const rowCity = String(row.city || '').toLowerCase().trim();
          const rowProvince = String(row.province || '').toLowerCase().trim();
          const rowCountry = String(row.country || '').toLowerCase().trim();
          
          const matchesCity = rowCity === city.toLowerCase().trim();
          const matchesCountry = rowCountry === country.toLowerCase().trim();
          const matchesProvince = !province || rowProvince === province.toLowerCase().trim();
          
          return matchesCity && matchesCountry && matchesProvince;
        });

        if (cityData) {
          // Check if any connectivity indicators have values
          const hasSpeed = cityData.speed != null && !isNaN(cityData.speed) && cityData.speed > 0;
          const hasLatency = cityData.latency != null && !isNaN(cityData.latency) && cityData.latency > 0;
          
          hasConnectivityData = hasSpeed || hasLatency;
          if (hasConnectivityData) {
            console.log(`[Status] Found connectivity data for ${city}`);
            break;
          }
        }
      }
    } catch (error) {
      console.log(`[Status] No connectivity data found for ${city}:`, error.message);
    }

    // Determine status based on what was found
    if (hasMobilePingData && hasConnectivityData) {
      console.log(`[Status] ${city}: calculated (both)`);
      return 'calculated';
    } else if (hasConnectivityData) {
      console.log(`[Status] ${city}: connectivity_only`);
      return 'connectivity_only';
    } else if (hasMobilePingData) {
      console.log(`[Status] ${city}: mobile_ping_only`);
      return 'mobile_ping_only';
    } else {
      console.log(`[Status] ${city}: not_calculated`);
      return 'not_calculated';
    }
  } catch (error) {
    console.error(`[Status] Error checking calculation status for ${city}:`, error);
    return 'not_calculated';
  }
}

/**
 * Batch check calculation status for multiple cities
 * More efficient than checking each city individually
 */
export async function batchCheckCityCalculationStatus(cities, dateRange, dataSource) {
  try {
    console.log(`[Status] Batch checking calculation status for ${cities.length} cities in ${dateRange}`);
    
    const statusMap = new Map();
    
    // Initialize all cities as not_calculated
    cities.forEach(city => {
      statusMap.set(city.name.toLowerCase(), 'not_calculated');
    });

    // Load all mobile ping summary data once
    let mobilePingSummary = [];
    try {
      const prefix = `${dataSource}/summary/${dateRange}/`;
      const listCommand = new ListObjectsV2Command({
        Bucket: RESULT_BUCKET,
        Prefix: prefix
      });

      const result = await s3Client.send(listCommand);
      const csvFiles = (result.Contents || []).filter(obj => obj.Key.endsWith('.csv.gz'));

      for (const file of csvFiles) {
        const data = await readGzippedCsv(RESULT_BUCKET, file.Key);
        mobilePingSummary = mobilePingSummary.concat(data);
      }
      
      console.log(`[Status] Loaded ${mobilePingSummary.length} rows of mobile ping summary data`);
    } catch (error) {
      console.log(`[Status] No mobile ping summary data found:`, error.message);
    }

    // Load all connectivity data once
    let connectivitySummary = [];
    try {
      const prefix = `summary/${dateRange}/`;
      const listCommand = new ListObjectsV2Command({
        Bucket: CONNECTIVITY_RESULT_BUCKET,
        Prefix: prefix
      });

      const result = await s3Client.send(listCommand);
      const csvFiles = (result.Contents || []).filter(obj => 
        obj.Key.endsWith('.csv.gz') || obj.Key.endsWith('-connectivity.csv.gz')
      );

      for (const file of csvFiles) {
        const data = await readGzippedCsv(CONNECTIVITY_RESULT_BUCKET, file.Key);
        connectivitySummary = connectivitySummary.concat(data);
      }
      
      console.log(`[Status] Loaded ${connectivitySummary.length} rows of connectivity summary data`);
    } catch (error) {
      console.log(`[Status] No connectivity summary data found:`, error.message);
    }

    // Check each city against the loaded data
    cities.forEach(cityObj => {
      const parts = cityObj.name.split(',').map(p => p.trim());
      let city, province, country;
      
      if (parts.length === 2) {
        [city, country] = parts;
        province = '';
      } else {
        [city, province, country] = parts;
      }

      const cityLower = city.toLowerCase();
      const provinceLower = (province || '').toLowerCase();
      const countryLower = country.toLowerCase();

      // Check mobile ping data
      const hasMobilePing = mobilePingSummary.some(row => {
        const rowCity = String(row.city || '').toLowerCase().trim();
        const rowProvince = String(row.province || '').toLowerCase().trim();
        const rowCountry = String(row.country || '').toLowerCase().trim();
        
        if (rowCity !== cityLower || rowCountry !== countryLower) return false;
        if (provinceLower && rowProvince !== provinceLower) return false;
        
        const hasOutAtNight = row.out_at_night != null && !isNaN(row.out_at_night);
        const hasLeisure = row.leisure_dwell_time != null && !isNaN(row.leisure_dwell_time);
        const hasCultural = row.cultural_visits != null && !isNaN(row.cultural_visits);
        
        return hasOutAtNight || hasLeisure || hasCultural;
      });

      // Check connectivity data
      const hasConnectivity = connectivitySummary.some(row => {
        const rowCity = String(row.city || '').toLowerCase().trim();
        const rowProvince = String(row.province || '').toLowerCase().trim();
        const rowCountry = String(row.country || '').toLowerCase().trim();
        
        if (rowCity !== cityLower || rowCountry !== countryLower) return false;
        if (provinceLower && rowProvince !== provinceLower) return false;
        
        const hasSpeed = row.speed != null && !isNaN(row.speed) && row.speed > 0;
        const hasLatency = row.latency != null && !isNaN(row.latency) && row.latency > 0;
        
        return hasSpeed || hasLatency;
      });

      // Determine status
      let status;
      if (hasMobilePing && hasConnectivity) {
        status = 'calculated';
      } else if (hasConnectivity) {
        status = 'connectivity_only';
      } else if (hasMobilePing) {
        status = 'mobile_ping_only';
      } else {
        status = 'not_calculated';
      }

      statusMap.set(cityObj.name.toLowerCase(), status);
      console.log(`[Status] ${cityObj.name}: ${status}`);
    });

    return statusMap;
  } catch (error) {
    console.error(`[Status] Error in batch status check:`, error);
    // Return map with all cities as not_calculated on error
    const errorMap = new Map();
    cities.forEach(city => {
      errorMap.set(city.name.toLowerCase(), 'not_calculated');
    });
    return errorMap;
  }
}
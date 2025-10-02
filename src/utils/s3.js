import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { readParquet, writeParquet, Table, WriterPropertiesBuilder, Compression } from 'parquet-wasm';
import { tableFromArrays, tableToIPC, tableFromIPC } from 'apache-arrow';
import * as turf from '@turf/turf';

// Proper WASM initialization for parquet-wasm
let wasmInitialized = false;
const initializeWasm = async () => {
  if (!wasmInitialized) {
    try {
      const { default: init } = await import('parquet-wasm');
      await init();
      wasmInitialized = true;
      console.log('Parquet WASM initialized successfully');
    } catch (error) {
      console.error('Failed to initialize WASM:', error);
      throw new Error(`WASM initialization failed: ${error.message}`);
    }
  }
};

// Helper function to create a Table from JavaScript data using Apache Arrow
const createParquetTable = (data) => {
  try {
    if (!data || data.length === 0) {
      throw new Error('No data provided to create table');
    }
    
    // Convert JavaScript array to columnar format for Apache Arrow
    const columns = {};
    const firstRow = data[0];
    
    // Initialize columns
    Object.keys(firstRow).forEach(key => {
      columns[key] = [];
    });
    
    // Fill columns with data
    data.forEach(row => {
      Object.keys(firstRow).forEach(key => {
        columns[key].push(row[key]);
      });
    });
    
    // Create Apache Arrow table from columns
    const arrowTable = tableFromArrays(columns);
    
    // Convert to IPC stream and then to parquet-wasm Table
    const ipcBuffer = tableToIPC(arrowTable, 'stream');
    const wasmTable = Table.fromIPCStream(ipcBuffer);
    
    return wasmTable;
  } catch (error) {
    console.error('Error creating parquet table:', error);
    throw error;
  }
};

const s3Client = new S3Client({
  region: process.env.REACT_APP_AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.REACT_APP_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.REACT_APP_AWS_SECRET_ACCESS_KEY,
    ...(process.env.REACT_APP_AWS_SESSION_TOKEN && {
      sessionToken: process.env.REACT_APP_AWS_SESSION_TOKEN
    }),
  },
});

const BUCKET_NAME = 'veraset-data-qoli-dev';

// Helper function to normalize names (lowercase, replace spaces with underscores)
const normalizeName = (name) => {
  return name.toLowerCase().replace(/\s+/g, '_');
};

// Layer definitions
const layerDefinitions = {
  mobility: [
    { tags: { highway: true }, filename: 'roads' },
    { tags: { highway: ['footway'] }, filename: 'sidewalks' },
    { tags: { amenity: ['parking', 'parking_space'] }, filename: 'parking' },
    { tags: { highway: ['bus_stop'] }, filename: 'transit_stops' },
    { tags: { railway: ['subway'] }, filename: 'subways' },
    { tags: { railway: ['rail'] }, filename: 'railways' },
    { tags: { aeroway: ['runway'] }, filename: 'airports' },
    { tags: { amenity: ['bicycle_parking'] }, filename: 'bicycle_parking' },
  ],
  governance: [
    { tags: { amenity: ['police'] }, filename: 'police' },
    { tags: { office: ['government'] }, filename: 'government_offices' },
    { tags: { amenity: ['fire_station'] }, filename: 'fire_stations' },
  ],
  health: [
    { tags: { amenity: ['hospital'] }, filename: 'hospitals' },
    { tags: { amenity: ['doctors'] }, filename: 'doctor_offices' },
    { tags: { amenity: ['dentist'] }, filename: 'dentists' },
    { tags: { amenity: ['clinic'] }, filename: 'clinics' },
    { tags: { amenity: ['pharmacy'] }, filename: 'pharmacies' },
    { tags: { healthcare: ['alternative'] }, filename: 'acupuncture' },
  ],
  economy: [
    { tags: { building: ['industrial'] }, filename: 'factories' },
    { tags: { amenity: ['bank'] }, filename: 'banks' },
    { tags: { shop: true }, filename: 'shops' },
    { tags: { amenity: ['restaurant'] }, filename: 'restaurants' },
  ],
  environment: [
    { tags: { leisure: ['park'] }, filename: 'parks' },
    { tags: { landuse: ['greenfield'] }, filename: 'open_green_spaces' },
    { tags: { natural: true }, filename: 'nature' },
    { tags: { waterway: true }, filename: 'waterways' },
    { tags: { natural: ['water'] }, filename: 'lakes' },
  ],
  culture: [
    { tags: { tourism: ['attraction'] }, filename: 'tourist_attractions' },
    { tags: { tourism: ['theme_park'] }, filename: 'theme_parks' },
    { tags: { sport: true }, filename: 'gyms' },
    { tags: { amenity: ['theatre'] }, filename: 'theatres' },
    { tags: { leisure: ['stadium'] }, filename: 'stadiums' },
    { tags: { amenity: ['place_of_worship'] }, filename: 'places_of_worship' },
  ],
  education: [
    { tags: { amenity: ['school'] }, filename: 'schools' },
    { tags: { amenity: ['university'] }, filename: 'universities' },
    { tags: { amenity: ['college'] }, filename: 'colleges' },
    { tags: { amenity: ['library'] }, filename: 'libraries' },
  ],
  housing: [
    { tags: { building: ['house'] }, filename: 'houses' },
    { tags: { building: ['apartments'] }, filename: 'apartments' },
  ],
  social: [
    { tags: { amenity: ['bar'] }, filename: 'bars' },
    { tags: { amenity: ['cafe'] }, filename: 'cafes' },
    { tags: { leisure: ['casino'] }, filename: 'leisure_facilities' },
  ],
};

// Recursive function to scan S3 directories deeply
const scanS3Directory = async (prefix, targetFileName = null) => {
  console.log(`Scanning S3 directory: ${prefix}`);
  
  const foundFiles = [];
  let continuationToken = null;
  
  do {
    const command = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: prefix,
      ContinuationToken: continuationToken,
      MaxKeys: 1000,
    });
    
    const response = await s3Client.send(command);
    
    if (response.Contents) {
      for (const obj of response.Contents) {
        if (!targetFileName || obj.Key.endsWith(targetFileName)) {
          foundFiles.push(obj.Key);
          console.log(`Found target file: ${obj.Key}`);
        }
      }
    }
    
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);
  
  console.log(`Completed scanning ${prefix}: found ${foundFiles.length} files`);
  return foundFiles;
};

// Get all cities from BOTH population and data buckets
export const getAllCities = async () => {
  try {
    console.log('=== Scanning S3 buckets for cities ===');
    
    const cities = new Map();
    
    // Scan population bucket for city_data.snappy.parquet files
    console.log('--- Scanning population bucket recursively ---');
    const populationFiles = await scanS3Directory('population/', 'city_data.snappy.parquet');
    
    for (const filePath of populationFiles) {
      console.log(`Processing population file: ${filePath}`);
      
      // Extract city info from path: population/country=canada/province=ontario/city=toronto/city_data.snappy.parquet
      const pathMatch = filePath.match(/population\/country=([^/]+)\/province=([^/]*)\/city=([^/]+)\/city_data\.snappy\.parquet$/);
      if (pathMatch) {
        const [, country, province, city] = pathMatch;
        
        console.log(`Extracted from population: country=${country}, province=${province}, city=${city}`);
        
        try {
          const cityData = await getCityData(country, province, city);
          if (cityData) {
            console.log(`Successfully loaded: ${cityData.name}`);
            cities.set(cityData.name, cityData);
          }
        } catch (error) {
          console.warn(`Error loading city data for ${city}:`, error);
        }
      } else {
        console.warn(`Could not parse population file path: ${filePath}`);
      }
    }
    
    // Scan data bucket for additional cities
    console.log('--- Scanning data bucket for additional cities ---');
    const dataFiles = await scanS3Directory('data/', '.snappy.parquet');
    
    // Extract unique cities from data files
    const dataCities = new Set();
    for (const filePath of dataFiles) {
      // Match pattern: data/country=X/province=Y/city=Z/domain=D/layer.snappy.parquet
      const pathMatch = filePath.match(/data\/country=([^/]+)\/province=([^/]*)\/city=([^/]+)\//);
      if (pathMatch) {
        const [, country, province, city] = pathMatch;
        const cityKey = `${city}|${province}|${country}`;
        dataCities.add(cityKey);
      }
    }
    
    // Process unique cities found in data bucket
    for (const cityKey of dataCities) {
      const [city, province, country] = cityKey.split('|');
      const cityName = province ? `${city}, ${province}, ${country}` : `${city}, ${country}`;
      
      if (!cities.has(cityName)) {
        console.log(`Found data-only city: ${cityName}`);
        
        try {
          // Try to load from population bucket first
          const cityData = await getCityData(country, province, city);
          if (cityData) {
            cities.set(cityData.name, cityData);
          } else {
            // Create minimal city entry for data-only cities
            const minimalCity = {
              name: cityName,
              longitude: 0,
              latitude: 0,
              boundary: null,
              population: null,
              size: null,
              sdg_region: null,
            };
            console.log(`Created minimal entry for: ${cityName}`);
            cities.set(cityName, minimalCity);
          }
        } catch (error) {
          console.warn(`Error processing data-only city ${cityName}:`, error);
        }
      }
    }
    
    const allCities = Array.from(cities.values());
    console.log(`=== FINAL RESULTS ===`);
    console.log(`Total cities found: ${allCities.length}`);
    allCities.forEach(city => console.log(`- ${city.name}`));
    
    return allCities;
  } catch (error) {
    console.error('Error scanning for cities:', error);
    return [];
  }
};

// Get city metadata from population bucket
// Get city metadata from population bucket
const getCityData = async (country, province, city) => {
  try {
    await initializeWasm();
    console.log(`=== Loading city data for: ${country}/${province}/${city} ===`);
    
    // Helper function to convert stream to ArrayBuffer
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
      
      // Calculate total length
      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const result = new Uint8Array(totalLength);
      
      // Combine chunks
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      
      return result.buffer;
    };
    
    // Load city metadata from population bucket
    const cityMetaKey = `population/country=${country}/province=${province}/city=${city}/city_data.snappy.parquet`;
    
    try {
      const getCommand = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: cityMetaKey,
      });
      
      const fileResponse = await s3Client.send(getCommand);
      
      // Convert stream to ArrayBuffer for browser environment
      const arrayBuffer = await streamToArrayBuffer(fileResponse.Body);
      const uint8Array = new Uint8Array(arrayBuffer);
      
      // Read as WASM Table, convert to Arrow Table
      const wasmTable = readParquet(uint8Array);
      const ipcBytes = wasmTable.intoIPCStream();
      const arrowTable = tableFromIPC(ipcBytes);
      
      if (arrowTable.numRows > 0) {
        // Extract first row data
        const row = {};
        for (const field of arrowTable.schema.fields) {
          const column = arrowTable.getChild(field.name);
          row[field.name] = column.get(0);
        }
        
        const cityData = {
          name: row.name,
          longitude: parseFloat(row.longitude) || 0,
          latitude: parseFloat(row.latitude) || 0,
          boundary: row.boundary,
          population: row.population ? parseInt(row.population) : null,
          size: row.size ? parseFloat(row.size) : null,
          sdg_region: row.sdg_region,
        };
        
        console.log(`Successfully loaded city data for: ${cityData.name}`);
        return cityData;
      }
    } catch (error) {
      console.log(`No city metadata found for ${city}: ${error.message}`);
      return null;
    }
    
    return null;
  } catch (error) {
    console.error(`Error getting city data for ${city}:`, error);
    return null;
  }
};

// Save city metadata to population bucket
export const saveCityData = async (cityData, country, province, city) => {
  try {
    await initializeWasm();
    
    const normalizedCountry = normalizeName(country);
    const normalizedProvince = normalizeName(province);
    const normalizedCity = normalizeName(city);

    // Prepare data for parquet
    const data = [{
      name: cityData.name,
      longitude: parseFloat(cityData.longitude) || 0,
      latitude: parseFloat(cityData.latitude) || 0,
      boundary: cityData.boundary,
      population: cityData.population ? parseInt(cityData.population) : null,
      size: cityData.size ? parseFloat(cityData.size) : null,
      sdg_region: cityData.sdg_region || null,
    }];

    // Create Table and write parquet file with Snappy compression
    const table = createParquetTable(data);
    const writerProperties = new WriterPropertiesBuilder()
      .setCompression(Compression.SNAPPY)
      .build();
    const buffer = writeParquet(table, writerProperties);
    const key = `population/country=${normalizedCountry}/province=${normalizedProvince}/city=${normalizedCity}/city_data.snappy.parquet`;
    
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: 'application/octet-stream',
    });

    await s3Client.send(command);
    console.log('City data saved to population bucket successfully');
  } catch (error) {
    console.error('Error saving city data to population bucket:', error);
    throw error;
  }
};

// Get available layers for a city
export const getAvailableLayersForCity = async (cityName) => {
  try {
    const parts = cityName.split(',').map(p => p.trim());
    if (parts.length < 2) return {};
    
    // Handle different city name formats
    let city, province, country;
    if (parts.length === 2) {
      [city, country] = parts;
      province = '';
    } else {
      [city, province, country] = parts;
    }
    
    const normalizedCity = normalizeName(city);
    const normalizedProvince = normalizeName(province);
    const normalizedCountry = normalizeName(country);
    
    const availableLayers = {};
    
    // Check each layer individually in data bucket
    for (const [domain, layers] of Object.entries(layerDefinitions)) {
      for (const layer of layers) {
        try {
          const key = `data/country=${normalizedCountry}/province=${normalizedProvince}/city=${normalizedCity}/domain=${domain}/${layer.filename}.snappy.parquet`;
          
          const listCommand = new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
            Prefix: key,
            MaxKeys: 1,
          });
          
          const response = await s3Client.send(listCommand);
          
          if (response.Contents && response.Contents.length > 0) {
            availableLayers[layer.filename] = true;
          }
        } catch (error) {
          console.warn(`Error checking layer ${layer.filename}:`, error);
        }
      }
    }
    
    return availableLayers;
  } catch (error) {
    console.error('Error getting available layers:', error);
    return {};
  }
};

// Load city features for display
export const loadCityFeatures = async (cityName, activeLayers) => {
  try {
    await initializeWasm();
    console.log('=== S3: loadCityFeatures called ===', { cityName, activeLayers });
    
    const parts = cityName.split(',').map(p => p.trim());
    if (parts.length < 2) {
      console.error('Invalid city name format:', cityName);
      return [];
    }
    
    // Handle different city name formats
    let city, province, country;
    if (parts.length === 2) {
      [city, country] = parts;
      province = '';
    } else {
      [city, province, country] = parts;
    }
    
    const normalizedCity = normalizeName(city);
    const normalizedProvince = normalizeName(province);
    const normalizedCountry = normalizeName(country);
    
    console.log('=== S3: Normalized names ===', { normalizedCity, normalizedProvince, normalizedCountry });
    
    const features = [];
    const activeLayerNames = Object.keys(activeLayers).filter(layer => activeLayers[layer]);
    console.log('=== S3: Active layer names ===', activeLayerNames);
    
    if (activeLayerNames.length === 0) {
      console.log('=== S3: No active layers selected ===');
      return [];
    }
    
    // Helper function to convert stream to ArrayBuffer
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
      
      // Calculate total length
      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const result = new Uint8Array(totalLength);
      
      // Combine chunks
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      
      return result.buffer;
    };
    
    // Load features from individual layer files in data bucket
    for (const [domain, layers] of Object.entries(layerDefinitions)) {
      for (const layer of layers) {
        if (activeLayerNames.includes(layer.filename)) {
          const key = `data/country=${normalizedCountry}/province=${normalizedProvince}/city=${normalizedCity}/domain=${domain}/${layer.filename}.snappy.parquet`;
          
          try {
            console.log(`=== S3: Attempting to load layer ${layer.filename} from ${key} ===`);
            
            // First, check if the object exists
            const listCommand = new ListObjectsV2Command({
              Bucket: BUCKET_NAME,
              Prefix: key,
              MaxKeys: 1,
            });
            
            const listResponse = await s3Client.send(listCommand);
            
            if (!listResponse.Contents || listResponse.Contents.length === 0) {
              console.log(`=== S3: Layer file does not exist: ${key} ===`);
              continue;
            }
            
            console.log(`=== S3: File exists, size: ${listResponse.Contents[0].Size} bytes ===`);
            
            // Now fetch the object
            const command = new GetObjectCommand({
              Bucket: BUCKET_NAME,
              Key: key,
            });
            
            const response = await s3Client.send(command);
            
            if (!response.Body) {
              console.error(`=== S3: No body in response for ${key} ===`);
              continue;
            }
            
            // Convert stream to ArrayBuffer
            console.log(`=== S3: Converting stream to buffer for ${layer.filename} ===`);
            const arrayBuffer = await streamToArrayBuffer(response.Body);
            const uint8Array = new Uint8Array(arrayBuffer);
            
            console.log(`=== S3: Buffer size: ${uint8Array.length} bytes ===`);
            
            if (uint8Array.length === 0) {
              console.error(`=== S3: Empty buffer for ${key} ===`);
              continue;
            }
            
            // Read parquet file
            console.log(`=== S3: Parsing parquet data for ${layer.filename} ===`);
            const wasmTable = readParquet(uint8Array);
            
            // Convert WASM Table to IPC Stream, then to Arrow Table
            console.log(`=== S3: Converting WASM Table to Arrow Table ===`);
            const ipcBytes = wasmTable.intoIPCStream();
            const arrowTable = tableFromIPC(ipcBytes);
            
            console.log(`=== S3: Arrow Table info ===`, {
              numRows: arrowTable.numRows,
              numCols: arrowTable.numCols,
              columnNames: arrowTable.schema.fields.map(f => f.name)
            });
            
            if (arrowTable.numRows === 0) {
              console.log(`=== S3: No rows in Arrow table for ${layer.filename} ===`);
              continue;
            }
            
            // Convert Arrow Table to JavaScript objects
            const data = [];
            for (let i = 0; i < arrowTable.numRows; i++) {
              const row = {};
              for (const field of arrowTable.schema.fields) {
                const column = arrowTable.getChild(field.name);
                row[field.name] = column.get(i);
              }
              data.push(row);
            }
            
            console.log(`=== S3: Loaded ${data.length} rows for layer ${layer.filename} ===`);
            
            if (data.length === 0) {
              console.log(`=== S3: No data rows in ${layer.filename} ===`);
              continue;
            }
            
            // Log first row structure for debugging
            console.log(`=== S3: First row structure for ${layer.filename} ===`, Object.keys(data[0]));
            
            let validFeatureCount = 0;
            let invalidGeometryCount = 0;
            let parseErrorCount = 0;
            
            for (let i = 0; i < data.length; i++) {
              const row = data[i];
              let geometry = null;
              
              // Handle different geometry types with proper GeoJSON parsing
              if (row.geometry_coordinates) {
                try {
                  // Parse the stored GeoJSON geometry
                  const geoJsonGeometry = JSON.parse(row.geometry_coordinates);
                  
                  if (geoJsonGeometry && geoJsonGeometry.type && geoJsonGeometry.coordinates) {
                    // For display purposes, we need Point geometry for markers
                    if (geoJsonGeometry.type === 'Point') {
                      geometry = geoJsonGeometry;
                    } else {
                      // Use turf to get centroid for non-point geometries
                      try {
                        const turfFeature = { type: 'Feature', geometry: geoJsonGeometry, properties: {} };
                        const centroid = turf.centroid(turfFeature);
                        geometry = centroid.geometry;
                      } catch (centroidError) {
                        console.warn(`S3: Could not compute centroid for row ${i}:`, centroidError.message);
                        invalidGeometryCount++;
                      }
                    }
                  } else {
                    console.warn(`S3: Invalid GeoJSON structure in row ${i}`);
                    invalidGeometryCount++;
                  }
                } catch (parseError) {
                  console.warn(`S3: Error parsing stored GeoJSON geometry in row ${i}:`, parseError.message);
                  parseErrorCount++;
                }
              }
              
              // Fallback to stored longitude/latitude if no geometry or centroid failed
              if (!geometry && row.longitude != null && row.latitude != null) {
                const lon = parseFloat(row.longitude);
                const lat = parseFloat(row.latitude);
                
                if (!isNaN(lon) && !isNaN(lat)) {
                  geometry = {
                    type: 'Point',
                    coordinates: [lon, lat],
                  };
                }
              }
              
              // Only add feature if we have valid point geometry
              if (geometry && geometry.type === 'Point' &&
                  geometry.coordinates && geometry.coordinates.length === 2 &&
                  !isNaN(geometry.coordinates[0]) && !isNaN(geometry.coordinates[1])) {
                
                features.push({
                  type: 'Feature',
                  geometry,
                  properties: {
                    feature_name: row.feature_name || 'Unnamed',
                    layer_name: row.layer_name || layer.filename,
                    domain_name: row.domain_name || domain,
                  },
                });
                validFeatureCount++;
              } else {
                invalidGeometryCount++;
              }
            }
            
            console.log(`=== S3: Layer ${layer.filename} summary ===`, {
              totalRows: data.length,
              validFeatures: validFeatureCount,
              invalidGeometry: invalidGeometryCount,
              parseErrors: parseErrorCount
            });
            
          } catch (error) {
            console.error(`=== S3: Error loading layer ${layer.filename} ===`, {
              error: error.message,
              stack: error.stack,
              key: key
            });
          }
        }
      }
    }
    
    console.log(`=== S3: Returning total of ${features.length} features ===`);
    return features;
    
  } catch (error) {
    console.error('=== S3: Fatal error in loadCityFeatures ===', {
      error: error.message,
      stack: error.stack
    });
    return [];
  }
}

// Save individual layer
export const saveLayerFeatures = async (features, country, province, city, domain, layerName) => {
  try {
    await initializeWasm();
    
    if (features.length === 0) {
      console.log(`No features found for layer ${layerName}, skipping save`);
      return;
    }

    const normalizedCountry = normalizeName(country);
    const normalizedProvince = normalizeName(province);
    const normalizedCity = normalizeName(city);

    // Prepare data for parquet with proper GeoJSON geometry storage
    const data = features.map(feature => {
      const geometry = feature.geometry || (feature.type === 'Feature' ? feature.geometry : null);
      
      let geometryType = null;
      let longitude = null;
      let latitude = null;
      let geometryCoordinates = null;
      
      if (geometry) {
        geometryType = geometry.type;
        
        // Store complete GeoJSON geometry object as string
        geometryCoordinates = JSON.stringify(geometry);
        
        // Also store a representative point for indexing
        if (geometry.type === 'Point') {
          longitude = parseFloat(geometry.coordinates[0]) || 0;
          latitude = parseFloat(geometry.coordinates[1]) || 0;
        } else if (geometry.type === 'LineString' && geometry.coordinates.length > 0) {
          longitude = parseFloat(geometry.coordinates[0][0]) || 0;
          latitude = parseFloat(geometry.coordinates[0][1]) || 0;
        } else if (geometry.type === 'Polygon' && geometry.coordinates.length > 0 && geometry.coordinates[0].length > 0) {
          longitude = parseFloat(geometry.coordinates[0][0][0]) || 0;
          latitude = parseFloat(geometry.coordinates[0][0][1]) || 0;
        } else if (geometry.type === 'MultiLineString' && geometry.coordinates.length > 0 && geometry.coordinates[0].length > 0) {
          // Use first coordinate of first LineString
          longitude = parseFloat(geometry.coordinates[0][0][0]) || 0;
          latitude = parseFloat(geometry.coordinates[0][0][1]) || 0;
        } else if (geometry.type === 'MultiPolygon' && geometry.coordinates.length > 0 && geometry.coordinates[0].length > 0 && geometry.coordinates[0][0].length > 0) {
          // Use first coordinate of first ring of first polygon
          longitude = parseFloat(geometry.coordinates[0][0][0][0]) || 0;
          latitude = parseFloat(geometry.coordinates[0][0][0][1]) || 0;
        } else {
          // Fallback: try to compute centroid for complex geometries
          try {
            const turfFeature = { type: 'Feature', geometry, properties: {} };
            const centroid = turf.centroid(turfFeature);
            longitude = parseFloat(centroid.geometry.coordinates[0]) || 0;
            latitude = parseFloat(centroid.geometry.coordinates[1]) || 0;
          } catch (centroidError) {
            console.warn('Could not compute centroid, using 0,0:', centroidError);
            longitude = 0;
            latitude = 0;
          }
        }
      }
      
      return {
        feature_name: feature.properties?.name || feature.feature_name || null,
        geometry_type: geometryType,
        longitude: longitude,
        latitude: latitude,
        geometry_coordinates: geometryCoordinates, // This will be the full GeoJSON geometry object
        layer_name: feature.layer_name || layerName,
        domain_name: feature.domain_name || domain,
      };
    });

    // Create Table and write parquet file
    const table = createParquetTable(data);
    const writerProperties = new WriterPropertiesBuilder()
      .setCompression(Compression.SNAPPY)
      .build();
    const buffer = writeParquet(table, writerProperties);
    
    const key = `data/country=${normalizedCountry}/province=${normalizedProvince}/city=${normalizedCity}/domain=${domain}/${layerName}.snappy.parquet`;
    
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: 'application/octet-stream',
    });

    await s3Client.send(command);
    console.log(`Layer ${layerName} saved successfully with ${features.length} features`);
  } catch (error) {
    console.error(`Error saving layer ${layerName}:`, error);
    throw error;
  }
};

// Background processing function
export const processCityFeatures = async (cityData, country, province, city, onProgressUpdate) => {
  try {
    console.log(`Starting background processing for ${cityData.name}`);
    
    const boundary = JSON.parse(cityData.boundary);
    const allLayers = [];
    
    Object.entries(layerDefinitions).forEach(([domain, layers]) => {
      layers.forEach(layer => {
        allLayers.push({
          tags: layer.tags,
          filename: layer.filename,
          domain: domain,
        });
      });
    });

    let processedCount = 0;
    let savedCount = 0;
    const totalLayers = allLayers.length;

    // Process in smaller batches to avoid worker timeouts
    const BATCH_SIZE = 3;
    
    for (let i = 0; i < allLayers.length; i += BATCH_SIZE) {
      const batch = allLayers.slice(i, i + BATCH_SIZE);
      
      try {
        console.log(`Processing batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(totalLayers/BATCH_SIZE)}`);

        const worker = new Worker('/worker.js');
        
        const workerPromise = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            worker.terminate();
            reject(new Error('Worker timeout'));
          }, 180000); // 3 minutes timeout
          
          worker.onmessage = (e) => {
            clearTimeout(timeout);
            worker.terminate();
            
            if (e.data.error) {
              reject(new Error(e.data.error));
            } else {
              resolve(e.data.results);
            }
          };
          
          worker.onerror = (error) => {
            clearTimeout(timeout);
            worker.terminate();
            reject(error);
          };
        });

        worker.postMessage({
          cityName: cityData.name,
          boundary: boundary,
          tagsList: batch,
        });

        const batchResults = await workerPromise;
        
        // Group results by layer and save each layer separately
        const layerGroups = {};
        
        batchResults.forEach(feature => {
          const layerName = feature.layer_name;
          const domain = feature.domain_name;
          
          if (!layerGroups[layerName]) {
            layerGroups[layerName] = {
              features: [],
              domain: domain,
            };
          }
          
          layerGroups[layerName].features.push(feature);
        });
        
        // Process each layer in the batch
        for (const layerInfo of batch) {
          const layerData = layerGroups[layerInfo.filename];
          
          if (layerData && layerData.features && layerData.features.length > 0) {
            // Save layers that have features
            await saveLayerFeatures(
              layerData.features,
              country,
              province,
              city,
              layerData.domain,
              layerInfo.filename
            );
            savedCount++;
            console.log(`Saved layer ${layerInfo.filename} with ${layerData.features.length} features`);
          } else {
            // Layer processed but has no features - don't save, but count as complete
            console.log(`Layer ${layerInfo.filename} processed with 0 features (not saving to S3)`);
          }
          
          // Increment counter for ALL layers (with or without features)
          processedCount++;
          
          // Emit progress update after each layer
          if (onProgressUpdate) {
            onProgressUpdate(cityData.name, {
              processed: processedCount,
              saved: savedCount,
              total: totalLayers,
              status: 'processing'
            });
          }
        }

        console.log(`Completed batch processing (${processedCount}/${totalLayers} layers processed, ${savedCount} saved)`);

        // Small delay between batches
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (batchError) {
        console.warn(`Error processing batch:`, batchError);
        // Still increment counter for failed batch layers
        processedCount += batch.length;
        
        // Update progress even on error
        if (onProgressUpdate) {
          onProgressUpdate(cityData.name, {
            processed: processedCount,
            saved: savedCount,
            total: totalLayers,
            status: 'processing'
          });
        }
      }
    }

    console.log(`Completed background processing for ${cityData.name}: ${processedCount}/${totalLayers} layers processed, ${savedCount} saved`);
    
    // Final completion update
    if (onProgressUpdate) {
      onProgressUpdate(cityData.name, {
        processed: processedCount,
        saved: savedCount,
        total: totalLayers,
        status: 'complete'
      });
    }
    
    return { processedLayers: processedCount, savedLayers: savedCount, totalLayers };
  } catch (error) {
    console.error('Error in background processing:', error);
    throw error;
  }
};

// Check if a city has data layers available
export const cityHasDataLayers = async (cityName) => {
  try {
    const parts = cityName.split(',').map(p => p.trim());
    if (parts.length < 2) return false;
    
    let city, province, country;
    if (parts.length === 2) {
      [city, country] = parts;
      province = '';
    } else {
      [city, province, country] = parts;
    }
    
    const normalizedCity = normalizeName(city);
    const normalizedProvince = normalizeName(province);
    const normalizedCountry = normalizeName(country);
    
    // Check if data directory exists for this city
    const command = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: `data/country=${normalizedCountry}/province=${normalizedProvince}/city=${normalizedCity}/`,
      MaxKeys: 1,
    });
    
    const response = await s3Client.send(command);
    return response.Contents && response.Contents.length > 0;
  } catch (error) {
    console.warn(`Error checking if city has data layers: ${cityName}`, error);
    return false;
  }
};

// Get all cities with their data availability status
export const getAllCitiesWithDataStatus = async () => {
  try {
    const cities = await getAllCities();
    const citiesWithStatus = [];
    
    for (const city of cities) {
      try {
        const hasDataLayers = await cityHasDataLayers(city.name);
        citiesWithStatus.push({
          ...city,
          hasDataLayers
        });
      } catch (error) {
        console.warn(`Error checking data status for ${city.name}:`, error);
        citiesWithStatus.push({
          ...city,
          hasDataLayers: false
        });
      }
    }
    
    return citiesWithStatus;
  } catch (error) {
    console.error('Error getting cities with data status:', error);
    return [];
  }
};

export const deleteCityData = async (cityName) => {
  try {
    const parts = cityName.split(',').map(p => p.trim());
    if (parts.length < 2) {
      throw new Error('Invalid city name format');
    }

    let city, province, country;
    if (parts.length === 2) {
      [city, country] = parts;
      province = '';
    } else {
      [city, province, country] = parts;
    }

    const normalizedCity = normalizeName(city);
    const normalizedProvince = normalizeName(province);
    const normalizedCountry = normalizeName(country);

    console.log(`Deleting city data for: ${cityName}`);
    console.log(`Normalized: country=${normalizedCountry}, province=${normalizedProvince}, city=${normalizedCity}`);

    const objectsToDelete = [];

    // List and collect population data files
    const populationPrefix = `population/country=${normalizedCountry}/province=${normalizedProvince}/city=${normalizedCity}/`;
    console.log(`Scanning population prefix: ${populationPrefix}`);
    
    let populationContinuationToken = null;
    do {
      const populationListCommand = new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: populationPrefix,
        ContinuationToken: populationContinuationToken,
      });
      const populationResponse = await s3Client.send(populationListCommand);
      
      if (populationResponse.Contents && populationResponse.Contents.length > 0) {
        populationResponse.Contents.forEach(obj => {
          objectsToDelete.push({ Key: obj.Key });
          console.log(`Found population file: ${obj.Key}`);
        });
      }
      
      populationContinuationToken = populationResponse.NextContinuationToken;
    } while (populationContinuationToken);

    // List and collect data layer files
    const dataPrefix = `data/country=${normalizedCountry}/province=${normalizedProvince}/city=${normalizedCity}/`;
    console.log(`Scanning data prefix: ${dataPrefix}`);
    
    let dataContinuationToken = null;
    do {
      const dataListCommand = new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: dataPrefix,
        ContinuationToken: dataContinuationToken,
      });
      const dataResponse = await s3Client.send(dataListCommand);
      
      if (dataResponse.Contents && dataResponse.Contents.length > 0) {
        dataResponse.Contents.forEach(obj => {
          objectsToDelete.push({ Key: obj.Key });
          console.log(`Found data file: ${obj.Key}`);
        });
      }
      
      dataContinuationToken = dataResponse.NextContinuationToken;
    } while (dataContinuationToken);

    console.log(`Total files to delete: ${objectsToDelete.length}`);

    if (objectsToDelete.length > 0) {
      // S3 DeleteObjects has a limit of 1000 objects per request
      const BATCH_SIZE = 1000;
      
      for (let i = 0; i < objectsToDelete.length; i += BATCH_SIZE) {
        const batch = objectsToDelete.slice(i, i + BATCH_SIZE);
        
        const deleteCommand = new DeleteObjectsCommand({
          Bucket: BUCKET_NAME,
          Delete: {
            Objects: batch,
            Quiet: false,
          },
        });
        
        const deleteResponse = await s3Client.send(deleteCommand);
        
        if (deleteResponse.Deleted) {
          console.log(`Deleted ${deleteResponse.Deleted.length} objects in batch ${Math.floor(i / BATCH_SIZE) + 1}`);
        }
        
        if (deleteResponse.Errors && deleteResponse.Errors.length > 0) {
          console.error('Errors during deletion:', deleteResponse.Errors);
        }
      }
      
      console.log(`Successfully deleted all data for ${cityName} from both population and data folders`);
    } else {
      console.log(`No files found to delete for ${cityName}`);
    }
  } catch (error) {
    console.error('Error deleting city data:', error);
    throw error;
  }
};
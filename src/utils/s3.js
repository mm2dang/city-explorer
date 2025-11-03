import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { readParquet, writeParquet, Table, WriterPropertiesBuilder, Compression } from 'parquet-wasm';
import { tableFromArrays, tableToIPC, tableFromIPC } from 'apache-arrow';
import * as turf from '@turf/turf';

// Helper function to convert stream to ArrayBuffer - used throughout the module
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

const validateCredentials = () => {
  const accessKeyId = process.env.REACT_APP_AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.REACT_APP_AWS_SECRET_ACCESS_KEY;
  const region = process.env.REACT_APP_AWS_REGION;
  const bucketName = process.env.REACT_APP_S3_BUCKET_NAME;

  const errors = [];

  if (!accessKeyId || accessKeyId.trim() === '') {
    errors.push('REACT_APP_AWS_ACCESS_KEY_ID is missing or empty');
  }
  if (!secretAccessKey || secretAccessKey.trim() === '') {
    errors.push('REACT_APP_AWS_SECRET_ACCESS_KEY is missing or empty');
  }
  if (!region || region.trim() === '') {
    errors.push('REACT_APP_AWS_REGION is missing or empty');
  }
  if (!bucketName || bucketName.trim() === '') {
    errors.push('REACT_APP_S3_BUCKET_NAME is missing or empty');
  }

  // Session token is optional
  const sessionToken = process.env.REACT_APP_AWS_SESSION_TOKEN;
  if (sessionToken && sessionToken.trim() === '') {
    errors.push('REACT_APP_AWS_SESSION_TOKEN is set but empty (remove it from .env if not using temporary credentials)');
  }

  return { valid: errors.length === 0, errors };
};

// Validate credentials on load
const credentialCheck = validateCredentials();
if (!credentialCheck.valid) {
  console.error('AWS Credential Configuration Errors:', credentialCheck.errors);
  credentialCheck.errors.forEach(err => console.error(`  - ${err}`));
}

// Build credentials object more carefully
const buildCredentials = () => {
  const accessKeyId = process.env.REACT_APP_AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.REACT_APP_AWS_SECRET_ACCESS_KEY?.trim();
  const sessionToken = process.env.REACT_APP_AWS_SESSION_TOKEN?.trim();

  const credentials = {
    accessKeyId,
    secretAccessKey,
  };

  // Only add sessionToken if it exists and is not empty
  if (sessionToken && sessionToken.length > 0) {
    credentials.sessionToken = sessionToken;
  }

  return credentials;
};

const s3Client = new S3Client({
  region: process.env.REACT_APP_AWS_REGION || 'us-east-1',
  credentials: buildCredentials(),
});

const BUCKET_NAME = process.env.REACT_APP_S3_BUCKET_NAME;
let DATA_SOURCE_PREFIX = 'city';

// Optional: Add validation to ensure the bucket name is defined
if (!process.env.REACT_APP_S3_BUCKET_NAME) {
  console.error('REACT_APP_S3_BUCKET_NAME is not defined in the .env file');
  throw new Error('S3 bucket name is not configured');
}

export const setDataSource = (source) => {
  if (source === 'city' || source === 'osm') {
    DATA_SOURCE_PREFIX = source;
    console.log(`Data source set to: ${DATA_SOURCE_PREFIX}`);
  } else {
    console.error(`Invalid data source: ${source}. Must be 'city' or 'osm'`);
  }
};

export const getDataSource = () => {
  return DATA_SOURCE_PREFIX;
};

// Helper function to build path with data source prefix
const buildPath = (pathType, country, province, city, domain = null, layerName = null) => {
  const normalizedCountry = normalizeName(country);
  const normalizedProvince = normalizeName(province);
  const normalizedCity = normalizeName(city);
  
  let basePath = `${DATA_SOURCE_PREFIX}/${pathType}/country=${normalizedCountry}/province=${normalizedProvince}/city=${normalizedCity}`;
  
  if (pathType === 'data' && domain && layerName) {
    basePath += `/domain=${domain}/${layerName}.snappy.parquet`;
  } else if (pathType === 'population') {
    basePath += '/city_data.snappy.parquet';
  } else if (pathType === 'data' && domain) {
    basePath += `/domain=${domain}/`;
  }
  
  return basePath;
};

// Helper function to normalize names (lowercase, replace spaces with underscores)
const normalizeName = (name) => {
  return name.toLowerCase().replace(/\s+/g, '_');
};

// Track active processing operations that can be cancelled
const activeProcessing = new Map();

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
    { tags: { leisure: true }, filename: 'leisure_facilities' },
  ],
};

// Recursive function to scan S3 directories deeply
const scanS3Directory = async (prefix, targetFileName = null) => {
  console.log(`Scanning S3 directory: ${prefix} (data source: ${DATA_SOURCE_PREFIX})`);
  
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
    console.log(`=== Scanning S3 buckets for cities (source: ${DATA_SOURCE_PREFIX}) ===`);
    
    const cities = new Map();
    
    // Scan population bucket for city_data.snappy.parquet files
    console.log('--- Scanning population bucket recursively ---');
    const populationFiles = await scanS3Directory(`${DATA_SOURCE_PREFIX}/population/`, 'city_data.snappy.parquet');
    
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
    const dataFiles = await scanS3Directory(`${DATA_SOURCE_PREFIX}/data/`, '.snappy.parquet');
    
    // Extract unique cities from data files (use normalized names as keys)
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
    
    // Create a normalized lookup map for existing cities
    const normalizedCityMap = new Map();
    for (const [cityName] of cities) {
      const parts = cityName.split(',').map(p => p.trim());
      let normalizedKey;
      if (parts.length === 3) {
        const [c, p, co] = parts;
        normalizedKey = `${normalizeName(c)}|${normalizeName(p)}|${normalizeName(co)}`;
      } else if (parts.length === 2) {
        const [c, co] = parts;
        normalizedKey = `${normalizeName(c)}||${normalizeName(co)}`;
      }
      if (normalizedKey) {
        normalizedCityMap.set(normalizedKey, cityName);
      }
    }
    
    // Process unique cities found in data bucket
    for (const cityKey of dataCities) {
      // Check if this city already exists using normalized comparison
      if (normalizedCityMap.has(cityKey)) {
        console.log(`City ${cityKey} already loaded from population bucket, skipping`);
        continue;
      }
      
      const [city, province, country] = cityKey.split('|');
      console.log(`Found data-only city: ${cityKey}`);
      
      try {
        // Try to load from population bucket first
        const cityData = await getCityData(country, province, city);
        if (cityData) {
          cities.set(cityData.name, cityData);
          console.log(`Loaded metadata for data-only city: ${cityData.name}`);
        } else {
          // Create minimal city entry for data-only cities (truly no metadata)
          const cityName = province ? `${city}, ${province}, ${country}` : `${city}, ${country}`;
          const minimalCity = {
            name: cityName,
            longitude: 0,
            latitude: 0,
            boundary: null,
            population: null,
            size: null,
            sdg_region: null,
          };
          console.log(`Created minimal entry for truly data-only city: ${cityName}`);
          cities.set(cityName, minimalCity);
        }
      } catch (error) {
        console.warn(`Error processing data-only city ${cityKey}:`, error);
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
const getCityData = async (country, province, city) => {
  try {
    await initializeWasm();
    console.log(`=== Loading city data for: ${country}/${province}/${city} (source: ${DATA_SOURCE_PREFIX}) ===`);
    
    // Load city metadata from population bucket
    const cityMetaKey = buildPath('population', country, province, city);

    console.log(`=== Loading city metadata from S3 ===`);
    console.log(`Bucket: ${BUCKET_NAME}`);
    console.log(`Key: ${cityMetaKey}`);
    console.log(`Full path: s3://${BUCKET_NAME}/${cityMetaKey}`);

    try {
      const getCommand = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: cityMetaKey,
        ResponseCacheControl: 'no-cache, no-store, must-revalidate',
        IfModifiedSince: new Date(0),
      });
      
      const fileResponse = await s3Client.send(getCommand);
      console.log(`Successfully fetched file, ContentLength: ${fileResponse.ContentLength}`);
      console.log(`Last Modified: ${fileResponse.LastModified}`);
      console.log(`ETag: ${fileResponse.ETag}`);
      
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

    // Validate population - remove all non-numeric characters including commas
    let populationValue = null;
    if (cityData.population) {
      const popStr = String(cityData.population).replace(/[^0-9]/g, '');
      if (popStr && popStr.length > 0) {
        const popNum = parseInt(popStr, 10);
        if (!isNaN(popNum) && popNum > 0) {
          populationValue = popNum;
        }
      }
    }

    // Validate size - remove commas but keep decimals
    let sizeValue = null;
    if (cityData.size) {
      const sizeStr = String(cityData.size).replace(/[^0-9.]/g, '');
      if (sizeStr && sizeStr.length > 0) {
        const sizeNum = parseFloat(sizeStr);
        if (!isNaN(sizeNum) && sizeNum > 0) {
          sizeValue = parseFloat(sizeNum.toFixed(2));
        }
      }
    }

    // Validate coordinates
    let longitude = 0;
    let latitude = 0;
    const lon = Number(cityData.longitude);
    const lat = Number(cityData.latitude);
    
    if (!isNaN(lon) && lon >= -180 && lon <= 180) {
      longitude = parseFloat(lon.toFixed(6));
    }
    if (!isNaN(lat) && lat >= -90 && lat <= 90) {
      latitude = parseFloat(lat.toFixed(6));
    }

    const data = [{
      name: String(cityData.name || '').trim(),
      longitude: longitude,
      latitude: latitude,
      boundary: cityData.boundary ? String(cityData.boundary) : null,
      population: populationValue,
      size: sizeValue,
      sdg_region: cityData.sdg_region ? String(cityData.sdg_region) : null,
    }];

    console.log('Saving city data:', {
      name: data[0].name,
      longitude: data[0].longitude,
      latitude: data[0].latitude,
      population: data[0].population,
      size: data[0].size,
      sdg_region: data[0].sdg_region,
      boundary_length: data[0].boundary ? data[0].boundary.length : 0
    });

    // Create Table and write parquet file with Snappy compression
    const table = createParquetTable(data);
    const writerProperties = new WriterPropertiesBuilder()
      .setCompression(Compression.SNAPPY)
      .build();
    const buffer = writeParquet(table, writerProperties);
    const key = buildPath('population', country, province, city);
    
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: 'application/octet-stream',
    });

    await s3Client.send(command);
    console.log('City data saved to population bucket successfully:', {
      key: key,
      size: buffer.length,
      population: populationValue,
      coordinates: [longitude, latitude]
    });
  } catch (error) {
    console.error('Error saving city data to population bucket:', error);
    throw error;
  }
};

export const moveCityData = async (oldCountry, oldProvince, oldCity, newCountry, newProvince, newCity) => {
  try {
    console.log(`Moving city data from ${oldCountry}/${oldProvince}/${oldCity} to ${newCountry}/${newProvince}/${newCity} (source: ${DATA_SOURCE_PREFIX})`);
    
    const oldNormalizedCountry = normalizeName(oldCountry);
    const oldNormalizedProvince = normalizeName(oldProvince);
    const oldNormalizedCity = normalizeName(oldCity);
    
    const newNormalizedCountry = normalizeName(newCountry);
    const newNormalizedProvince = normalizeName(newProvince);
    const newNormalizedCity = normalizeName(newCity);
    
    // Don't move if paths are the same
    if (oldNormalizedCountry === newNormalizedCountry && 
        oldNormalizedProvince === newNormalizedProvince && 
        oldNormalizedCity === newNormalizedCity) {
      console.log('Source and destination are the same, skipping move');
      return;
    }
    
    const objectsToCopy = [];
    const objectsToDelete = [];
    
    // Find all data layer files - USE FULL PATH WITH PREFIX
    const dataPrefix = `${DATA_SOURCE_PREFIX}/data/country=${oldNormalizedCountry}/province=${oldNormalizedProvince}/city=${oldNormalizedCity}/`;
    console.log(`Scanning data prefix: ${dataPrefix}`);
    
    let continuationToken = null;
    do {
      const listCommand = new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: dataPrefix,
        ContinuationToken: continuationToken,
      });
      
      const response = await s3Client.send(listCommand);
      
      if (response.Contents && response.Contents.length > 0) {
        for (const obj of response.Contents) {
          // Extract the domain and layer name from the key
          const match = obj.Key.match(/domain=([^/]+)\/(.+)$/);
          if (match) {
            const [, domain, fileName] = match;
            // BUILD NEW KEY WITH FULL PREFIX
            const newKey = `${DATA_SOURCE_PREFIX}/data/country=${newNormalizedCountry}/province=${newNormalizedProvince}/city=${newNormalizedCity}/domain=${domain}/${fileName}`;
            
            objectsToCopy.push({
              oldKey: obj.Key,
              newKey: newKey
            });
            objectsToDelete.push({ Key: obj.Key });
            
            console.log(`Will copy: ${obj.Key} -> ${newKey}`);
          }
        }
      }
      
      continuationToken = response.NextContinuationToken;
    } while (continuationToken);
    
    console.log(`Found ${objectsToCopy.length} data files to move`);
    
    // Copy all files to new location - use GetObject/PutObject instead of CopyObject
    for (const { oldKey, newKey } of objectsToCopy) {
      try {
        console.log(`Attempting to copy via read/write: ${oldKey} -> ${newKey}`);
        
        // Step 1: Get the source object
        const getCommand = new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: oldKey,
        });
        
        const getResponse = await s3Client.send(getCommand);
        
        // Convert stream to buffer using shared helper function
        const arrayBuffer = await streamToArrayBuffer(getResponse.Body);
        const objectData = new Uint8Array(arrayBuffer);
        
        // Step 2: Put the object at the new location
        const putCommand = new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: newKey,
          Body: objectData,
          ContentType: getResponse.ContentType || 'application/octet-stream',
        });
        
        await s3Client.send(putCommand);
        console.log(`Copied via read/write: ${oldKey} -> ${newKey}`);
        
      } catch (copyError) {
        console.error(`Error copying ${oldKey}:`, copyError.message);
        console.error(`Full error:`, copyError);
        throw copyError;
      }
    }
    
    // Delete old files
    if (objectsToDelete.length > 0) {
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
        
        await s3Client.send(deleteCommand);
        console.log(`Deleted batch of ${batch.length} old files`);
      }
    }
    
    console.log(`Successfully moved all data for city`);
  } catch (error) {
    console.error('Error moving city data:', error);
    throw error;
  }
};

// Get available layers for a city with metadata
export const getAvailableLayersForCity = async (cityName) => {
  try {
    const parts = cityName.split(',').map(p => p.trim());
    if (parts.length < 2) return {};
    
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
    
    // Scan all domains in the data bucket
    const dataPrefix = `${DATA_SOURCE_PREFIX}/data/country=${normalizedCountry}/province=${normalizedProvince}/city=${normalizedCity}/`;
    
    let continuationToken = null;
    do {
      const listCommand = new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: dataPrefix,
        ContinuationToken: continuationToken,
      });
      
      const response = await s3Client.send(listCommand);
      
      if (response.Contents) {
        for (const obj of response.Contents) {
          // Parse: data/country=X/province=Y/city=Z/domain=DOMAIN/LAYER_NAME.snappy.parquet
          const match = obj.Key.match(/domain=([^/]+)\/([^/]+)\.snappy\.parquet$/);
          if (match) {
            const [, domain, layerName] = match;
            
            // Find icon from layerDefinitions (for predefined layers)
            let icon = 'fas fa-map-marker-alt'; // default
            const domainLayers = layerDefinitions[domain];
            if (domainLayers) {
              const layerDef = domainLayers.find(l => l.filename === layerName);
              if (layerDef) {
                // This is a predefined layer - get icon from definitions
                const domainIconMap = {
                  mobility: { roads: 'fas fa-road', sidewalks: 'fas fa-walking', parking: 'fas fa-parking', 
                             transit_stops: 'fas fa-bus', subways: 'fas fa-subway', railways: 'fas fa-train', 
                             airports: 'fas fa-plane', bicycle_parking: 'fas fa-bicycle' },
                  governance: { police: 'fas fa-shield-alt', government_offices: 'fas fa-landmark', 
                               fire_stations: 'fas fa-fire-extinguisher' },
                  health: { hospitals: 'fas fa-hospital', doctor_offices: 'fas fa-user-md', 
                           dentists: 'fas fa-tooth', clinics: 'fas fa-clinic-medical', 
                           pharmacies: 'fas fa-pills', acupuncture: 'fas fa-hand-holding-heart' },
                  economy: { factories: 'fas fa-industry', banks: 'fas fa-university', 
                            shops: 'fas fa-store', restaurants: 'fas fa-utensils' },
                  environment: { parks: 'fas fa-tree', open_green_spaces: 'fas fa-leaf', 
                                nature: 'fas fa-mountain', waterways: 'fas fa-water', lakes: 'fas fa-tint' },
                  culture: { tourist_attractions: 'fas fa-camera', theme_parks: 'fas fa-ticket', 
                            gyms: 'fas fa-dumbbell', theatres: 'fas fa-theater-masks', 
                            stadiums: 'fas fa-futbol', places_of_worship: 'fas fa-pray' },
                  education: { schools: 'fas fa-school', universities: 'fas fa-university', 
                              colleges: 'fas fa-graduation-cap', libraries: 'fas fa-book' },
                  housing: { houses: 'fas fa-home', apartments: 'fas fa-building' },
                  social: { bars: 'fas fa-wine-glass-alt', cafes: 'fas fa-coffee', 
                           leisure_facilities: 'fas fa-dice' }
                };
                icon = domainIconMap[domain]?.[layerName] || 'fas fa-map-marker-alt';
              } else {
                // Custom layer - try to load metadata from the parquet file
                try {
                  console.log(`Loading icon for custom layer: ${layerName}`);
                  const layerFeatures = await loadLayerForEditing(cityName, domain, layerName);
                  if (layerFeatures.length > 0) {
                    // Check for icon in properties first, then fallback
                    const storedIcon = layerFeatures[0].properties?.icon || 
                                      layerFeatures[0].icon ||
                                      'fas fa-map-marker-alt';
                    icon = storedIcon;
                    console.log(`Found icon for ${layerName}: ${icon}`);
                  }
                } catch (error) {
                  console.warn(`Could not load metadata for custom layer ${layerName}:`, error);
                  icon = 'fas fa-map-marker-alt';
                }
              }
            }
            
            availableLayers[layerName] = {
              domain: domain,
              icon: icon
            };
          }
        }
      }
      
      continuationToken = response.NextContinuationToken;
    } while (continuationToken);
    
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
    console.log(`=== S3: loadCityFeatures called (source: ${DATA_SOURCE_PREFIX}) ===`, { cityName, activeLayers });
    
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
    
    // Load features from individual layer files in data bucket
    for (const [domain, layers] of Object.entries(layerDefinitions)) {
      for (const layer of layers) {
        if (activeLayerNames.includes(layer.filename)) {
          const key = buildPath('data', country, province, city, domain, layer.filename);
          
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

                  console.log(`=== RAW geometry_coordinates from S3 (first 200 chars) ===`, 
                    row.geometry_coordinates.substring(0, 200));
                  
                  if (geoJsonGeometry && geoJsonGeometry.type && geoJsonGeometry.coordinates) {
                    // Use the geometry directly - it's already valid GeoJSON
                    geometry = geoJsonGeometry;
                  } else {
                    console.warn(`S3: Invalid GeoJSON structure in row ${i}`);
                    invalidGeometryCount++;
                  }
                } catch (parseError) {
                  console.warn(`S3: Error parsing stored GeoJSON geometry in row ${i}:`, parseError.message);
                  parseErrorCount++;
                }
              }
              
              // Fallback to stored longitude/latitude if no geometry
              if (!geometry && row.longitude != null && row.latitude != null) {
                const lon = parseFloat(row.longitude);
                const lat = parseFloat(row.latitude);
                
                if (!isNaN(lon) && !isNaN(lat) && lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90) {
                  geometry = {
                    type: 'Point',
                    coordinates: [lon, lat],
                  };
                } else {
                  console.warn(`S3: Invalid fallback coordinates in row ${i}: [${lon}, ${lat}]`);
                  invalidGeometryCount++;
                }
              }
              
              // Add feature if we have valid geometry with proper coordinates
              if (geometry && geometry.type && geometry.coordinates) {
                // Validate coordinates based on geometry type
                let isValid = false;
                
                if (geometry.type === 'Point') {
                  const [lon, lat] = geometry.coordinates;
                  isValid = !isNaN(lon) && !isNaN(lat) && 
                           lon >= -180 && lon <= 180 && 
                           lat >= -90 && lat <= 90;
                } else if (geometry.type === 'LineString' || geometry.type === 'MultiPoint') {
                  isValid = Array.isArray(geometry.coordinates) && geometry.coordinates.length > 0;
                } else if (geometry.type === 'Polygon' || geometry.type === 'MultiLineString') {
                  isValid = Array.isArray(geometry.coordinates) && 
                           geometry.coordinates.length > 0 &&
                           Array.isArray(geometry.coordinates[0]);
                } else if (geometry.type === 'MultiPolygon') {
                  isValid = Array.isArray(geometry.coordinates) && 
                           geometry.coordinates.length > 0 &&
                           Array.isArray(geometry.coordinates[0]) &&
                           Array.isArray(geometry.coordinates[0][0]);
                }
                
                if (isValid) {
                  features.push({
                    type: 'Feature',
                    geometry,
                    properties: {
                      feature_name: row.feature_name || 'Unnamed',
                      layer_name: row.layer_name || layer.filename,
                      domain_name: row.domain_name || domain,
                      icon: row.icon || null
                    },
                  });
                  validFeatureCount++;
                  
                  if (validFeatureCount <= 3) {
                    console.log(`=== S3: Valid feature ${validFeatureCount} DETAILED ===`, {
                      type: geometry.type,
                      coordinateCount: geometry.type === 'Point' 
                        ? 1
                        : geometry.type === 'LineString'
                        ? geometry.coordinates.length
                        : geometry.type === 'MultiLineString'
                        ? geometry.coordinates.reduce((sum, line) => sum + line.length, 0)
                        : 'other',
                      firstCoordinate: geometry.type === 'Point'
                        ? geometry.coordinates
                        : geometry.type === 'LineString'
                        ? geometry.coordinates[0]
                        : geometry.type === 'MultiLineString'
                        ? geometry.coordinates[0][0]
                        : null,
                      lastCoordinate: geometry.type === 'LineString'
                        ? geometry.coordinates[geometry.coordinates.length - 1]
                        : geometry.type === 'MultiLineString'
                        ? geometry.coordinates[geometry.coordinates.length - 1][geometry.coordinates[geometry.coordinates.length - 1].length - 1]
                        : null,
                      properties: { feature_name: row.feature_name, layer_name: row.layer_name }
                    });
                  }
                } else {
                  console.warn(`S3: Invalid geometry validation in row ${i}:`, geometry.type);
                  invalidGeometryCount++;
                }
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
    
    // Also check for custom layers that might not be in layerDefinitions
    try {
      const customLayersPrefix = `${DATA_SOURCE_PREFIX}/data/country=${normalizedCountry}/province=${normalizedProvince}/city=${normalizedCity}/`;
      
      let continuationToken = null;
      do {
        const listCommand = new ListObjectsV2Command({
          Bucket: BUCKET_NAME,
          Prefix: customLayersPrefix,
          ContinuationToken: continuationToken,
        });
        
        const response = await s3Client.send(listCommand);
        
        if (response.Contents) {
          for (const obj of response.Contents) {
            // Parse: data/country=X/province=Y/city=Z/domain=DOMAIN/LAYER_NAME.snappy.parquet
            const match = obj.Key.match(/domain=([^/]+)\/([^/]+)\.snappy\.parquet$/);
            if (match) {
              const [, domain, layerName] = match;
              
              // Check if this layer is active and not already processed
              if (activeLayerNames.includes(layerName)) {
                // Check if it's a custom layer (not in layerDefinitions)
                const domainLayers = layerDefinitions[domain];
                const isPredefined = domainLayers && domainLayers.some(l => l.filename === layerName);
                
                if (!isPredefined) {
                  console.log(`=== S3: Found custom layer ${layerName} in domain ${domain} ===`);
                  
                  // Load the custom layer using the same logic
                  try {
                    const command = new GetObjectCommand({
                      Bucket: BUCKET_NAME,
                      Key: obj.Key,
                    });
                    
                    const response = await s3Client.send(command);
                    const arrayBuffer = await streamToArrayBuffer(response.Body);
                    const uint8Array = new Uint8Array(arrayBuffer);
                    
                    const wasmTable = readParquet(uint8Array);
                    const ipcBytes = wasmTable.intoIPCStream();
                    const arrowTable = tableFromIPC(ipcBytes);
                    
                    const data = [];
                    for (let i = 0; i < arrowTable.numRows; i++) {
                      const row = {};
                      for (const field of arrowTable.schema.fields) {
                        const column = arrowTable.getChild(field.name);
                        row[field.name] = column.get(i);
                      }
                      data.push(row);
                    }
                    
                    console.log(`=== S3: Loaded ${data.length} rows for custom layer ${layerName} ===`);
                    
                    for (const row of data) {
                      let geometry = null;
                      
                      if (row.geometry_coordinates) {
                        try {
                          const geoJsonGeometry = JSON.parse(row.geometry_coordinates);
                          
                          if (geoJsonGeometry && (geoJsonGeometry.type === 'LineString' || geoJsonGeometry.type === 'MultiLineString')) {
                            console.log(`[LOAD] Loading feature from layer ${layerName}:`, {
                              type: geoJsonGeometry.type,
                              coordCount: geoJsonGeometry.type === 'LineString' 
                                ? geoJsonGeometry.coordinates.length 
                                : geoJsonGeometry.coordinates.reduce((sum, line) => sum + line.length, 0),
                              firstCoord: geoJsonGeometry.type === 'LineString' 
                                ? geoJsonGeometry.coordinates[0] 
                                : geoJsonGeometry.coordinates[0][0],
                              rawStringLength: row.geometry_coordinates.length
                            });
                          }
                          
                          if (geoJsonGeometry && geoJsonGeometry.type && geoJsonGeometry.coordinates) {
                            geometry = geoJsonGeometry;
                          }
                        } catch (parseError) {
                          console.warn(`S3: Error parsing stored GeoJSON geometry:`, parseError.message);
                        }
                      }
                      
                      if (!geometry && row.longitude != null && row.latitude != null) {
                        const lon = parseFloat(row.longitude);
                        const lat = parseFloat(row.latitude);
                        
                        if (!isNaN(lon) && !isNaN(lat) && lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90) {
                          geometry = {
                            type: 'Point',
                            coordinates: [lon, lat],
                          };
                        }
                      }
                      
                      if (geometry && geometry.type && geometry.coordinates) {
                        features.push({
                          type: 'Feature',
                          geometry,
                          properties: {
                            feature_name: row.feature_name || 'Unnamed',
                            layer_name: row.layer_name || layerName,
                            domain_name: row.domain_name || domain,
                            icon: row.icon || null
                          },
                        });
                      }
                    }
                  } catch (customLayerError) {
                    console.error(`=== S3: Error loading custom layer ${layerName} ===`, customLayerError);
                  }
                }
              }
            }
          }
        }
        
        continuationToken = response.NextContinuationToken;
      } while (continuationToken);
      
    } catch (customLayersError) {
      console.warn('=== S3: Error scanning for custom layers ===', customLayersError);
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
};

const validateBoundaryPolygon = (geometry) => {
  if (!geometry || !geometry.coordinates) {
    throw new Error('Invalid boundary geometry');
  }

  if (geometry.type === 'Polygon') {
    for (let i = 0; i < geometry.coordinates.length; i++) {
      const ring = geometry.coordinates[i];
      if (!Array.isArray(ring) || ring.length < 4) {
        throw new Error(
          `Polygon ring ${i} has ${ring.length} positions. ` +
          `Each LinearRing must have at least 4 positions (minimum valid polygon).`
        );
      }
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        throw new Error(`Polygon ring ${i} is not closed`);
      }
    }
  } else if (geometry.type === 'MultiPolygon') {
    for (let i = 0; i < geometry.coordinates.length; i++) {
      for (let j = 0; j < geometry.coordinates[i].length; j++) {
        const ring = geometry.coordinates[i][j];
        if (!Array.isArray(ring) || ring.length < 4) {
          throw new Error(
            `MultiPolygon [${i}][${j}] has ${ring.length} positions. ` +
            `Each LinearRing must have at least 4 positions.`
          );
        }
        const first = ring[0];
        const last = ring[ring.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) {
          throw new Error(`MultiPolygon [${i}][${j}] is not closed`);
        }
      }
    }
  }
};

const clipLineStringSegmentBySegment = (lineCoords, boundaryFeature) => {
  console.log('Clipping LineString with', lineCoords.length, 'points');
  
  // Check if completely within
  const lineFeature = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: lineCoords },
    properties: {}
  };
  
  try {
    const isFullyWithin = turf.booleanWithin(lineFeature, boundaryFeature);
    
    // CRITICAL: Even if booleanWithin returns true, check if line intersects boundary edge
    let lineIntersectsBoundary = false;
    try {
      const intersections = turf.lineIntersect(lineFeature, boundaryFeature);
      lineIntersectsBoundary = intersections.features.length > 0;
      console.log('Line intersects boundary edge?', lineIntersectsBoundary);
    } catch (intersectError) {
      console.warn('Error checking line intersection with boundary:', intersectError);
    }
    
    if (isFullyWithin && !lineIntersectsBoundary) {
      console.log('LineString is fully within boundary (verified - no edge crossings)');
      return [lineCoords]; // Return as array of segments
    }
  } catch (error) {
    console.warn('Error checking if line is fully within:', error);
  }
  
  console.log('LineString crosses boundary - clipping needed');
  
  // Line crosses boundary - clip it segment by segment
  const clippedSegments = [];
  let currentSegment = [];
  
  for (let i = 0; i < lineCoords.length - 1; i++) {
    const point1 = lineCoords[i];
    const point2 = lineCoords[i + 1];
    
    let p1Inside, p2Inside;
    try {
      p1Inside = turf.booleanPointInPolygon(turf.point(point1), boundaryFeature);
      p2Inside = turf.booleanPointInPolygon(turf.point(point2), boundaryFeature);
    } catch (error) {
      console.warn('Error checking point in polygon:', error);
      continue;
    }
    
    if (p1Inside && p2Inside) {
      // Both points inside - BUT check if this specific segment crosses boundary
      const segment = turf.lineString([point1, point2]);
      let segmentCrossesBoundary = false;
      try {
        const segmentIntersections = turf.lineIntersect(segment, boundaryFeature);
        segmentCrossesBoundary = segmentIntersections.features.length > 0;
      } catch (err) {
        console.warn('Error checking segment intersection:', err);
      }
      
      if (!segmentCrossesBoundary) {
        // Truly inside - add to current segment
        if (currentSegment.length === 0) {
          currentSegment.push(point1);
        }
        currentSegment.push(point2);
      } else {
        // Segment goes outside and comes back in - need to split
        console.log('Segment appears inside but crosses boundary - splitting');
        
        if (currentSegment.length === 0) {
          currentSegment.push(point1);
        }
        
        // Find intersection points
        const intersections = turf.lineIntersect(segment, boundaryFeature);
        if (intersections.features.length >= 2) {
          // Exit and re-entry
          const exitPoint = intersections.features[0].geometry.coordinates;
          const entryPoint = intersections.features[1].geometry.coordinates;
          
          // Complete current segment at exit point
          currentSegment.push(exitPoint);
          if (currentSegment.length >= 2) {
            clippedSegments.push([...currentSegment]);
          }
          
          // Start new segment at entry point
          currentSegment = [entryPoint, point2];
        }
      }
      
    } else if (p1Inside && !p2Inside) {
      // Crossing from inside to outside - find intersection and end segment
      if (currentSegment.length === 0) {
        currentSegment.push(point1);
      }
      
      // Find where this segment crosses the boundary
      const segment = turf.lineString([point1, point2]);
      try {
        const intersections = turf.lineIntersect(segment, boundaryFeature);
        if (intersections.features.length > 0) {
          // Add the intersection point (exit point)
          const exitPoint = intersections.features[0].geometry.coordinates;
          currentSegment.push(exitPoint);
          console.log('Found exit point:', exitPoint);
        }
      } catch (err) {
        console.warn('Error finding exit intersection:', err);
      }
      
      // Save this segment
      if (currentSegment.length >= 2) {
        clippedSegments.push([...currentSegment]);
        console.log('Saved segment with', currentSegment.length, 'points (exiting boundary)');
      }
      currentSegment = [];
      
    } else if (!p1Inside && p2Inside) {
      // Crossing from outside to inside - find intersection and start new segment
      const segment = turf.lineString([point1, point2]);
      try {
        const intersections = turf.lineIntersect(segment, boundaryFeature);
        if (intersections.features.length > 0) {
          // Start new segment with entry point
          const entryPoint = intersections.features[0].geometry.coordinates;
          currentSegment = [entryPoint, point2];
          console.log('Found entry point:', entryPoint);
        } else {
          // No intersection found, start with p2
          currentSegment = [point2];
        }
      } catch (err) {
        console.warn('Error finding entry intersection:', err);
        currentSegment = [point2];
      }
      
    } else {
      // Both points outside
      // Check if segment crosses through the boundary (enters and exits)
      const segment = turf.lineString([point1, point2]);
      try {
        const intersections = turf.lineIntersect(segment, boundaryFeature);
        if (intersections.features.length >= 2) {
          // Segment passes through boundary - keep the middle part
          const entry = intersections.features[0].geometry.coordinates;
          const exit = intersections.features[1].geometry.coordinates;
          clippedSegments.push([entry, exit]);
          console.log('Segment crosses through boundary - keeping middle part');
        }
      } catch (err) {
        console.warn('Error checking segment crossing:', err);
      }
      // If segment doesn't cross boundary, ignore it
    }
  }
  
  // Don't forget the last segment if we were building one
  if (currentSegment.length >= 2) {
    clippedSegments.push(currentSegment);
    console.log('Saved final segment with', currentSegment.length, 'points');
  }
  
  console.log('LineString clipping resulted in', clippedSegments.length, 'segments');
  return clippedSegments;
};

const clipMultiLineStringSegmentBySegment = (multiLineCoords, boundaryFeature) => {
  console.log('Clipping MultiLineString with', multiLineCoords.length, 'lines');
  const allClippedSegments = [];
  
  for (const lineCoords of multiLineCoords) {
    const lineFeature = {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: lineCoords },
      properties: {}
    };
    
    // Check if this line intersects boundary
    let intersects;
    try {
      intersects = turf.booleanIntersects(lineFeature, boundaryFeature);
    } catch (error) {
      console.warn('Error checking intersection:', error);
      continue;
    }
    
    if (!intersects) {
      continue;
    }
    
    // Check if completely within
    try {
      const isFullyWithin = turf.booleanWithin(lineFeature, boundaryFeature);
      
      // CRITICAL: Even if booleanWithin returns true, check if line intersects boundary edge
      let lineIntersectsBoundary = false;
      try {
        const intersections = turf.lineIntersect(lineFeature, boundaryFeature);
        lineIntersectsBoundary = intersections.features.length > 0;
        console.log('MultiLineString component intersects boundary edge?', lineIntersectsBoundary);
      } catch (intersectError) {
        console.warn('Error checking line intersection with boundary:', intersectError);
      }
      
      if (isFullyWithin && !lineIntersectsBoundary) {
        allClippedSegments.push(lineCoords);
        continue;
      }
    } catch (error) {
      console.warn('Error checking if line is fully within:', error);
    }
    
    // Line crosses boundary - clip it segment by segment
    let currentSegment = [];
    
    for (let i = 0; i < lineCoords.length - 1; i++) {
      const point1 = lineCoords[i];
      const point2 = lineCoords[i + 1];
      
      let p1Inside, p2Inside;
      try {
        p1Inside = turf.booleanPointInPolygon(turf.point(point1), boundaryFeature);
        p2Inside = turf.booleanPointInPolygon(turf.point(point2), boundaryFeature);
      } catch (error) {
        console.warn('Error checking point in polygon:', error);
        continue;
      }
      
      if (p1Inside && p2Inside) {
        // Both points inside - BUT check if this specific segment crosses boundary
        const segment = turf.lineString([point1, point2]);
        let segmentCrossesBoundary = false;
        try {
          const segmentIntersections = turf.lineIntersect(segment, boundaryFeature);
          segmentCrossesBoundary = segmentIntersections.features.length > 0;
        } catch (err) {
          console.warn('Error checking segment intersection:', err);
        }
        
        if (!segmentCrossesBoundary) {
          // Truly inside - add to current segment
          if (currentSegment.length === 0) {
            currentSegment.push(point1);
          }
          currentSegment.push(point2);
        } else {
          // Segment goes outside and comes back in - need to split
          console.log('MultiLineString segment appears inside but crosses boundary - splitting');
          
          if (currentSegment.length === 0) {
            currentSegment.push(point1);
          }
          
          // Find intersection points
          const intersections = turf.lineIntersect(segment, boundaryFeature);
          if (intersections.features.length >= 2) {
            // Exit and re-entry
            const exitPoint = intersections.features[0].geometry.coordinates;
            const entryPoint = intersections.features[1].geometry.coordinates;
            
            // Complete current segment at exit point
            currentSegment.push(exitPoint);
            if (currentSegment.length >= 2) {
              allClippedSegments.push([...currentSegment]);
            }
            
            // Start new segment at entry point
            currentSegment = [entryPoint, point2];
          }
        }
        
      } else if (p1Inside && !p2Inside) {
        // Exit boundary
        if (currentSegment.length === 0) {
          currentSegment.push(point1);
        }
        
        const segment = turf.lineString([point1, point2]);
        try {
          const intersections = turf.lineIntersect(segment, boundaryFeature);
          if (intersections.features.length > 0) {
            currentSegment.push(intersections.features[0].geometry.coordinates);
          }
        } catch (err) {
          console.warn('Error finding exit intersection:', err);
        }
        
        if (currentSegment.length >= 2) {
          allClippedSegments.push([...currentSegment]);
        }
        currentSegment = [];
        
      } else if (!p1Inside && p2Inside) {
        // Enter boundary
        const segment = turf.lineString([point1, point2]);
        try {
          const intersections = turf.lineIntersect(segment, boundaryFeature);
          if (intersections.features.length > 0) {
            currentSegment = [intersections.features[0].geometry.coordinates, point2];
          } else {
            currentSegment = [point2];
          }
        } catch (err) {
          console.warn('Error finding entry intersection:', err);
          currentSegment = [point2];
        }
        
      } else {
        // Both outside - check for pass-through
        const segment = turf.lineString([point1, point2]);
        try {
          const intersections = turf.lineIntersect(segment, boundaryFeature);
          if (intersections.features.length >= 2) {
            allClippedSegments.push([
              intersections.features[0].geometry.coordinates,
              intersections.features[1].geometry.coordinates
            ]);
          }
        } catch (err) {
          console.warn('Error checking segment crossing:', err);
        }
      }
    }
    
    if (currentSegment.length >= 2) {
      allClippedSegments.push(currentSegment);
    }
  }
  
  console.log('MultiLineString clipping resulted in', allClippedSegments.length, 'segments');
  return allClippedSegments;
};

// Helper function to create a geometry hash for duplicate detection
const getGeometryHash = (geometry) => {
  if (!geometry || !geometry.coordinates) return null;
  
  try {
    // Round coordinates to 6 decimal places for comparison (about 0.1 meter precision)
    const roundCoord = (coord) => {
      if (Array.isArray(coord[0])) {
        return coord.map(roundCoord);
      }
      return [Number(coord[0].toFixed(6)), Number(coord[1].toFixed(6))];
    };
    
    const roundedCoords = roundCoord(geometry.coordinates);
    return `${geometry.type}:${JSON.stringify(roundedCoords)}`;
  } catch (error) {
    console.warn('Error creating geometry hash:', error);
    return null;
  }
};

const cropFeaturesByBoundary = (features, boundary) => {
  try {
    if (!boundary || features.length === 0) {
      return features;
    }

    // Parse boundary if it's a string
    let boundaryGeometry = typeof boundary === 'string' ? JSON.parse(boundary) : boundary;
    
    // If boundary is a Feature object, extract just the geometry
    if (boundaryGeometry.type === 'Feature' && boundaryGeometry.geometry) {
      console.log('Boundary is a Feature object, extracting geometry');
      boundaryGeometry = boundaryGeometry.geometry;
    }
    
    // Validate boundary polygon structure
    try {
      validateBoundaryPolygon(boundaryGeometry);
    } catch (validationError) {
      console.error('Invalid boundary polygon:', validationError.message);
      throw validationError;
    }
    
    // Create Turf feature from boundary (works for both Polygon and MultiPolygon)
    const boundaryFeature = {
      type: 'Feature',
      geometry: boundaryGeometry,
      properties: {}
    };
    
    console.log(`Cropping features against ${boundaryGeometry.type} boundary`);
    if (boundaryGeometry.type === 'MultiPolygon') {
      console.log(`MultiPolygon has ${boundaryGeometry.coordinates.length} separate polygons`);
    }
    
    const croppedFeatures = [];
    const seenGeometries = new Set();
    let fullyCroppedCount = 0;
    let partiallyCroppedCount = 0;
    let pointsInsideCount = 0;
    let pointsOutsideCount = 0;
    let geometryDuplicatesCount = 0;
    
    for (const feature of features) {
      try {
        const geometry = feature.geometry || (feature.type === 'Feature' ? feature.geometry : null);
        
        if (!geometry || !geometry.coordinates) {
          continue;
        }
        
        // Create Turf feature
        const turfFeature = {
          type: 'Feature',
          geometry: geometry,
          properties: feature.properties || {}
        };
        
        // Check if feature intersects with boundary (works for MultiPolygon)
        let intersects = false;
        try {
          intersects = turf.booleanIntersects(turfFeature, boundaryFeature);
        } catch (intersectError) {
          console.warn('Error checking intersection for feature:', intersectError.message);
          continue;
        }
        
        if (intersects) {
          try {
            let croppedGeometry = null;
            
            if (geometry.type === 'Point') {
              // For points, check if they're within the boundary
              let isWithin = false;
              try {
                isWithin = turf.booleanPointInPolygon(turfFeature, boundaryFeature);
              } catch (pointError) {
                console.warn('Error checking point in polygon:', pointError.message);
                continue;
              }
              
              if (isWithin) {
                croppedGeometry = geometry;
                pointsInsideCount++;
              } else {
                pointsOutsideCount++;
                continue;
              }
              
            } else if (geometry.type === 'LineString') {
              try {
                console.log('Processing LineString with', geometry.coordinates.length, 'points');
                
                const clippedSegments = clipLineStringSegmentBySegment(
                  geometry.coordinates, 
                  boundaryFeature
                );
                
                if (clippedSegments.length === 0) {
                  console.log('No segments inside boundary');
                  continue;
                } else if (clippedSegments.length === 1) {
                  console.log('Single segment inside boundary with', clippedSegments[0].length, 'points');
                  croppedGeometry = {
                    type: 'LineString',
                    coordinates: clippedSegments[0]
                  };
                } else {
                  console.log('Multiple segments inside boundary:', clippedSegments.map(s => s.length));
                  croppedGeometry = {
                    type: 'MultiLineString',
                    coordinates: clippedSegments
                  };
                }
              } catch (clipError) {
                console.error('Error clipping LineString:', clipError);
                croppedGeometry = geometry;
              }
              
            } else if (geometry.type === 'MultiLineString') {
              try {
                console.log('Processing MultiLineString with', geometry.coordinates.length, 'lines');
                
                const clippedSegments = clipMultiLineStringSegmentBySegment(
                  geometry.coordinates,
                  boundaryFeature
                );
                
                if (clippedSegments.length === 0) {
                  console.log('No segments inside boundary');
                  continue;
                } else if (clippedSegments.length === 1) {
                  console.log('Single segment inside boundary with', clippedSegments[0].length, 'points');
                  croppedGeometry = {
                    type: 'LineString',
                    coordinates: clippedSegments[0]
                  };
                } else {
                  console.log('Multiple segments inside boundary:', clippedSegments.map(s => s.length));
                  croppedGeometry = {
                    type: 'MultiLineString',
                    coordinates: clippedSegments
                  };
                }
              } catch (multiLineError) {
                console.error('Error processing MultiLineString:', multiLineError);
                croppedGeometry = geometry;
              }
              
            } else if (geometry.type === 'Polygon') {
              // Intersect polygon with boundary
              try {
                const intersection = turf.intersect(turfFeature, boundaryFeature);
                
                if (intersection && intersection.geometry) {
                  croppedGeometry = intersection.geometry;
                  
                  // Check if it was actually cropped or was fully inside
                  const isFullyWithin = turf.booleanWithin(turfFeature, boundaryFeature);
                  if (isFullyWithin) {
                    fullyCroppedCount++;
                  } else {
                    partiallyCroppedCount++;
                  }
                } else {
                  // Intersection failed, check if completely within
                  const isFullyWithin = turf.booleanWithin(turfFeature, boundaryFeature);
                  if (isFullyWithin) {
                    croppedGeometry = geometry;
                    fullyCroppedCount++;
                  }
                }
              } catch (intersectError) {
                console.warn('Error intersecting Polygon:', intersectError.message);
                // If intersection fails but intersects, keep original
                croppedGeometry = geometry;
              }
              
            } else if (geometry.type === 'MultiPolygon') {
              // Process each polygon in the MultiPolygon
              try {
                const croppedPolygons = [];
                
                for (const polygonCoords of geometry.coordinates) {
                  const polyFeature = {
                    type: 'Feature',
                    geometry: { type: 'Polygon', coordinates: polygonCoords },
                    properties: {}
                  };
                  
                  if (turf.booleanIntersects(polyFeature, boundaryFeature)) {
                    try {
                      const intersection = turf.intersect(polyFeature, boundaryFeature);
                      
                      if (intersection && intersection.geometry) {
                        if (intersection.geometry.type === 'Polygon') {
                          croppedPolygons.push(intersection.geometry.coordinates);
                        } else if (intersection.geometry.type === 'MultiPolygon') {
                          croppedPolygons.push(...intersection.geometry.coordinates);
                        }
                      }
                    } catch (intersectError) {
                      // If intersection fails, include original if it intersects
                      croppedPolygons.push(polygonCoords);
                    }
                  }
                }
                
                if (croppedPolygons.length > 0) {
                  if (croppedPolygons.length === 1) {
                    croppedGeometry = { type: 'Polygon', coordinates: croppedPolygons[0] };
                  } else {
                    croppedGeometry = { type: 'MultiPolygon', coordinates: croppedPolygons };
                  }
                  partiallyCroppedCount++;
                }
              } catch (multiPolyError) {
                console.warn('Error processing MultiPolygon:', multiPolyError.message);
                croppedGeometry = geometry;
              }
              
            } else {
              // For other geometry types, keep if they intersect
              croppedGeometry = geometry;
            }
            
            // Add cropped feature only if we have valid geometry
            if (croppedGeometry && croppedGeometry.type && croppedGeometry.coordinates) {
              // Validate the cropped geometry before adding
              if (validateCroppedGeometry(croppedGeometry)) {
                // Check for duplicate geometry
                const geomHash = getGeometryHash(croppedGeometry);
                if (geomHash && seenGeometries.has(geomHash)) {
                  geometryDuplicatesCount++;
                  console.log('Duplicate geometry detected after cropping, skipping');
                  continue;
                }
                
                if (geomHash) {
                  seenGeometries.add(geomHash);
                }
                
                croppedFeatures.push({
                  ...feature,
                  geometry: croppedGeometry
                });
              } else {
                console.warn('Cropped geometry failed validation, skipping');
              }
            }
            
          } catch (cropError) {
            console.warn('Error cropping individual feature:', cropError.message);
            // If cropping fails but feature intersects, try to include original
            // only if it's mostly within the boundary
            try {
              const isFullyWithin = turf.booleanWithin(turfFeature, boundaryFeature);
              if (isFullyWithin) {
                // Check for duplicate even for fully within features
                const geomHash = getGeometryHash(geometry);
                if (geomHash && seenGeometries.has(geomHash)) {
                  geometryDuplicatesCount++;
                  continue;
                }
                if (geomHash) {
                  seenGeometries.add(geomHash);
                }
                croppedFeatures.push(feature);
              }
            } catch (withinError) {
              // Skip this feature
            }
          }
        }
        
      } catch (featureError) {
        console.warn('Error processing feature for cropping:', featureError.message);
      }
    }
    
    console.log(`Cropping summary:`);
    console.log(`  Input features: ${features.length}`);
    console.log(`  Output features: ${croppedFeatures.length}`);
    console.log(`  Fully inside: ${fullyCroppedCount}`);
    console.log(`  Partially cropped: ${partiallyCroppedCount}`);
    console.log(`  Points inside: ${pointsInsideCount}`);
    console.log(`  Points outside: ${pointsOutsideCount}`);
    console.log(`  Geometry duplicates removed: ${geometryDuplicatesCount}`);
    console.log(`  Total removed: ${features.length - croppedFeatures.length}`);
    
    return croppedFeatures;
    
  } catch (error) {
    console.error('Error in cropFeaturesByBoundary:', error);
    console.warn('Boundary geometry type:', boundary?.type);
    console.warn('Features count:', features.length);
    // Return original features if cropping fails to avoid losing data
    return features;
  }
};

const validateCroppedGeometry = (geometry) => {
  try {
    if (!geometry || !geometry.type || !geometry.coordinates) {
      return false;
    }
    
    switch (geometry.type) {
      case 'Point':
        return Array.isArray(geometry.coordinates) && 
               geometry.coordinates.length === 2 &&
               !isNaN(geometry.coordinates[0]) && 
               !isNaN(geometry.coordinates[1]);
               
      case 'LineString':
        return Array.isArray(geometry.coordinates) && 
               geometry.coordinates.length >= 2 &&
               geometry.coordinates.every(coord => 
                 Array.isArray(coord) && 
                 coord.length === 2 &&
                 !isNaN(coord[0]) && 
                 !isNaN(coord[1])
               );
               
      case 'Polygon':
        if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) {
          return false;
        }
        // Check each ring
        for (const ring of geometry.coordinates) {
          if (!Array.isArray(ring) || ring.length < 4) {
            return false;
          }
          // Check if ring is closed
          const first = ring[0];
          const last = ring[ring.length - 1];
          if (first[0] !== last[0] || first[1] !== last[1]) {
            return false;
          }
          // Check all coordinates are valid
          if (!ring.every(coord => 
            Array.isArray(coord) && 
            coord.length === 2 &&
            !isNaN(coord[0]) && 
            !isNaN(coord[1])
          )) {
            return false;
          }
        }
        return true;
        
      case 'MultiLineString':
        if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) {
          return false;
        }
        return geometry.coordinates.every(line =>
          Array.isArray(line) && 
          line.length >= 2 &&
          line.every(coord => 
            Array.isArray(coord) && 
            coord.length === 2 &&
            !isNaN(coord[0]) && 
            !isNaN(coord[1])
          )
        );
        
      case 'MultiPolygon':
        if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) {
          return false;
        }
        // Check each polygon
        for (const polygon of geometry.coordinates) {
          if (!Array.isArray(polygon) || polygon.length === 0) {
            return false;
          }
          // Check each ring in the polygon
          for (const ring of polygon) {
            if (!Array.isArray(ring) || ring.length < 4) {
              return false;
            }
            // Check if ring is closed
            const first = ring[0];
            const last = ring[ring.length - 1];
            if (first[0] !== last[0] || first[1] !== last[1]) {
              return false;
            }
            // Check all coordinates are valid
            if (!ring.every(coord => 
              Array.isArray(coord) && 
              coord.length === 2 &&
              !isNaN(coord[0]) && 
              !isNaN(coord[1])
            )) {
              return false;
            }
          }
        }
        return true;
        
      default:
        return false;
    }
  } catch (error) {
    console.warn('Error validating geometry:', error);
    return false;
  }
};

// Save individual layer
export const saveLayerFeatures = async (features, country, province, city, domain, layerName, boundary = null) => {
  try {
    await initializeWasm();
    
    if (features.length === 0) {
      console.log(`No features found for layer ${layerName}, skipping save`);
      return;
    }

    let featuresToSave = features;
    
    // Only crop if boundary is provided (for automated processing)
    // If boundary is null, features are already cropped (manual uploads)
    if (boundary) {
      console.log(`Cropping ${features.length} features for layer ${layerName} by city boundary...`);
      featuresToSave = cropFeaturesByBoundary(features, boundary);
      
      if (featuresToSave.length === 0) {
        console.log(`No features remain after cropping for layer ${layerName}, skipping save`);
        return;
      }
      
      console.log(`After cropping: ${featuresToSave.length} features remain (${features.length - featuresToSave.length} removed)`);
    } else {
      console.log(`Using pre-cropped features for layer ${layerName}: ${featuresToSave.length} features`);
    }

    // Prepare data for parquet with proper GeoJSON geometry storage
    const data = featuresToSave.map(feature => {
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
          longitude = parseFloat(geometry.coordinates[0][0][0]) || 0;
          latitude = parseFloat(geometry.coordinates[0][0][1]) || 0;
        } else if (geometry.type === 'MultiPolygon' && geometry.coordinates.length > 0 && geometry.coordinates[0].length > 0 && geometry.coordinates[0][0].length > 0) {
          longitude = parseFloat(geometry.coordinates[0][0][0][0]) || 0;
          latitude = parseFloat(geometry.coordinates[0][0][0][1]) || 0;
        } else {
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
        feature_name: feature.properties?.name || feature.properties?.feature_name || feature.feature_name || null,
        geometry_type: geometryType,
        longitude: longitude,
        latitude: latitude,
        geometry_coordinates: geometryCoordinates,
        layer_name: feature.layer_name || feature.properties?.layer_name || layerName,
        domain_name: feature.domain_name || feature.properties?.domain_name || domain,
        icon: feature.icon || feature.properties?.icon || null
      };
    });

    // Create Table and write parquet file
    const table = createParquetTable(data);
    const writerProperties = new WriterPropertiesBuilder()
      .setCompression(Compression.SNAPPY)
      .build();
    const buffer = writeParquet(table, writerProperties);
    
    const key = buildPath('data', country, province, city, domain, layerName);
    
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: 'application/octet-stream',
    });

    await s3Client.send(command);
    
    if (boundary) {
      console.log(`Layer ${layerName} saved successfully with ${featuresToSave.length} features (${features.length - featuresToSave.length} cropped out)`);
    } else {
      console.log(`Layer ${layerName} saved successfully with ${featuresToSave.length} pre-cropped features`);
    }
  } catch (error) {
    console.error(`Error saving layer ${layerName}:`, error);
    throw error;
  }
};

// Save custom layer
export const saveCustomLayer = async (cityName, layerData, boundary = null) => {
  try {
    await initializeWasm();
    
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

    console.log(`Saving custom layer: ${layerData.name} for ${cityName} with icon: ${layerData.icon}`);
    console.log(`Initial feature count: ${layerData.features.length}`);

    // Prepare features with proper structure
    const features = layerData.features.map(f => ({
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        feature_name: f.properties?.name || f.properties?.feature_name || layerData.name,
        layer_name: layerData.name,
        domain_name: layerData.domain,
        icon: layerData.icon
      },
      icon: layerData.icon
    }));

    console.log(`Prepared ${features.length} features for saving`);
    
    // Validate that we have features to save
    if (features.length === 0) {
      console.warn(`No features to save for layer ${layerData.name}`);
      throw new Error('No features to save. All features may have been outside the city boundary.');
    }

    await saveLayerFeatures(
      features,
      country,
      province,
      city,
      layerData.domain,
      layerData.name,
      null
    );

    console.log(`Custom layer ${layerData.name} saved successfully with ${features.length} features`);
    return true;
  } catch (error) {
    console.error('Error saving custom layer:', error);
    throw error;
  }
};

// Delete a specific layer
export const deleteLayer = async (cityName, domain, layerName) => {
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

    const key = buildPath('data', country, province, city, domain, layerName);

    console.log(`Deleting layer: ${key}`);

    const deleteCommand = new DeleteObjectsCommand({
      Bucket: BUCKET_NAME,
      Delete: {
        Objects: [{ Key: key }],
        Quiet: false,
      },
    });

    const response = await s3Client.send(deleteCommand);
    
    if (response.Deleted && response.Deleted.length > 0) {
      console.log(`Successfully deleted layer: ${layerName}`);
      return true;
    } else if (response.Errors && response.Errors.length > 0) {
      throw new Error(`Failed to delete layer: ${response.Errors[0].Message}`);
    }
    
    return true;
  } catch (error) {
    console.error('Error deleting layer:', error);
    throw error;
  }
};

// Load layer features for editing
export const loadLayerForEditing = async (cityName, domain, layerName) => {
  try {
    await initializeWasm();
    
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

    const key = buildPath('data', country, province, city, domain, layerName);

    console.log(`Loading layer for editing: ${key}`);

    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    const response = await s3Client.send(command);
    const arrayBuffer = await streamToArrayBuffer(response.Body);
    const uint8Array = new Uint8Array(arrayBuffer);

    const wasmTable = readParquet(uint8Array);
    const ipcBytes = wasmTable.intoIPCStream();
    const arrowTable = tableFromIPC(ipcBytes);

    const features = [];
    for (let i = 0; i < arrowTable.numRows; i++) {
      const row = {};
      for (const field of arrowTable.schema.fields) {
        const column = arrowTable.getChild(field.name);
        row[field.name] = column.get(i);
      }

      let geometry = null;
      if (row.geometry_coordinates) {
        try {
          geometry = JSON.parse(row.geometry_coordinates);
        } catch (error) {
          console.warn('Could not parse geometry:', error);
        }
      }

      if (geometry) {
        features.push({
          type: 'Feature',
          geometry: geometry,
          properties: {
            name: row.feature_name || layerName,
            feature_name: row.feature_name,
            layer_name: row.layer_name || layerName,
            domain_name: row.domain_name || domain,
            icon: row.icon || null
          }
        });
      }
    }

    console.log(`Loaded ${features.length} features for editing`);
    return features;
  } catch (error) {
    console.error('Error loading layer for editing:', error);
    throw error;
  }
};

// Cancel processing for a specific city
export const cancelCityProcessing = async (cityName) => {
  const processingInfo = activeProcessing.get(cityName);
  
  if (processingInfo) {
    console.log(`Cancelling processing for ${cityName}`);
    processingInfo.shouldCancel = true;
    
    // Terminate any active worker
    if (processingInfo.worker) {
      processingInfo.worker.terminate();
      processingInfo.worker = null;
    }
    
    // Delete existing data
    try {
      await deleteCityData(cityName);
      console.log(`Deleted existing data for ${cityName} after cancellation`);
    } catch (error) {
      console.error(`Error deleting data after cancellation for ${cityName}:`, error);
    }
    
    // Remove from active processing
    activeProcessing.delete(cityName);
    
    return true;
  }
  
  return false;
};

export const isCityProcessing = (cityName) => {
  return activeProcessing.has(cityName);
};

// Background processing function
// Background processing function
export const processCityFeatures = async (cityData, country, province, city, onProgressUpdate, targetDataSource) => {
  try {
    console.log(`Starting background processing for ${cityData.name} in data source: ${targetDataSource}`);
    
    // Store the original data source prefix
    const originalDataSource = DATA_SOURCE_PREFIX;
    
    // Set the data source for this processing operation
    DATA_SOURCE_PREFIX = targetDataSource;
    
    try {
      // Initialize tracking for this city
      activeProcessing.set(cityData.name, { shouldCancel: false, worker: null });
      
      // Check if city still exists before starting
      const cityExists = await checkCityExists(country, province, city);
      if (!cityExists) {
        console.log(`City ${cityData.name} no longer exists, aborting processing`);
        activeProcessing.delete(cityData.name);
        if (onProgressUpdate) {
          onProgressUpdate(cityData.name, {
            processed: 0,
            saved: 0,
            total: 0,
            status: 'cancelled',
            dataSource: targetDataSource
          });
        }
        return { processedLayers: 0, savedLayers: 0, totalLayers: 0, cancelled: true };
      }
      
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
        // Check if processing should be cancelled
        const processingInfo = activeProcessing.get(cityData.name);
        if (!processingInfo || processingInfo.shouldCancel) {
          console.log(`Processing cancelled for ${cityData.name}`);
          activeProcessing.delete(cityData.name);
          
          if (onProgressUpdate) {
            onProgressUpdate(cityData.name, {
              processed: processedCount,
              saved: savedCount,
              total: totalLayers,
              status: 'cancelled',
              dataSource: targetDataSource
            });
          }
          
          return { processedLayers: processedCount, savedLayers: savedCount, totalLayers, cancelled: true };
        }
        
        // Check if city still exists
        const cityExists = await checkCityExists(country, province, city);
        if (!cityExists) {
          console.log(`City ${cityData.name} was deleted during processing, aborting`);
          activeProcessing.delete(cityData.name);
          
          // Delete any partially processed data
          try {
            await deleteCityData(cityData.name);
          } catch (error) {
            console.error(`Error cleaning up after city deletion:`, error);
          }
          
          if (onProgressUpdate) {
            onProgressUpdate(cityData.name, {
              processed: processedCount,
              saved: savedCount,
              total: totalLayers,
              status: 'cancelled',
              dataSource: targetDataSource
            });
          }
          
          return { processedLayers: processedCount, savedLayers: savedCount, totalLayers, cancelled: true };
        }
        
        const batch = allLayers.slice(i, i + BATCH_SIZE);
        
        try {
          console.log(`Processing batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(totalLayers/BATCH_SIZE)} for data source: ${targetDataSource}`);
        
          const worker = new Worker('/worker.js');
          
          // Store worker reference for potential cancellation
          if (activeProcessing.has(cityData.name)) {
            activeProcessing.get(cityData.name).worker = worker;
          }
          
          // Capture current counts for this batch
          const batchStartProcessed = processedCount;
          const batchStartSaved = savedCount;
          
          const workerPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              worker.terminate();
              reject(new Error('Worker timeout'));
            }, 180000); // 3 minutes timeout
            
            worker.onmessage = (e) => {
              console.log('===== WORKER MESSAGE RECEIVED =====');
              console.log('Message data:', e.data);
              console.log('Has progress?', !!e.data.progress);
              console.log('Has results?', !!e.data.results);
              
              // Check if this is a progress update (not final results)
              if (e.data.progress && !e.data.results) {
                console.log('===== PROGRESS UPDATE DETECTED =====');
                console.log('Worker progress:', e.data.progress);
                console.log('Progress fields:', {
                  processed: e.data.progress.processed,
                  saved: e.data.progress.saved,
                  total: e.data.progress.total,
                  status: e.data.progress.status
                });
                console.log('Batch start values:', {
                  batchStartProcessed,
                  batchStartSaved,
                  totalLayers
                });
                
                // Forward progress to the callback without terminating worker
                if (onProgressUpdate) {
                  const progressData = {
                    processed: batchStartProcessed + (e.data.progress.processed || 0),
                    saved: batchStartSaved + (e.data.progress.saved || 0),
                    total: totalLayers,
                    status: 'processing',
                    dataSource: targetDataSource
                  };
                  console.log('Calling onProgressUpdate with:', progressData);
                  onProgressUpdate(cityData.name, progressData);
                } else {
                  console.warn('onProgressUpdate callback is not defined!');
                }
                return; // Don't resolve/terminate - keep worker running
              }
              
              console.log('===== FINAL RESULTS RECEIVED =====');
              // This is the final result
              clearTimeout(timeout);
              worker.terminate();
              
              // Clear worker reference
              if (activeProcessing.has(cityData.name)) {
                activeProcessing.get(cityData.name).worker = null;
              }
              
              if (e.data.error) {
                reject(new Error(e.data.error));
              } else {
                resolve(e.data.results);
              }
            };
            
            worker.onerror = (error) => {
              clearTimeout(timeout);
              worker.terminate();
              
              // Clear worker reference
              if (activeProcessing.has(cityData.name)) {
                activeProcessing.get(cityData.name).worker = null;
              }
              
              reject(error);
            };
          });
        
          worker.postMessage({
            cityName: cityData.name,
            boundary: boundary,
            tagsList: batch,
          });
        
          const batchResults = await workerPromise;
          
          // Check again if processing should be cancelled after worker completes
          const processingInfoAfterWorker = activeProcessing.get(cityData.name);
          if (!processingInfoAfterWorker || processingInfoAfterWorker.shouldCancel) {
            console.log(`Processing cancelled for ${cityData.name} after worker completion`);
            activeProcessing.delete(cityData.name);
            
            if (onProgressUpdate) {
              onProgressUpdate(cityData.name, {
                processed: processedCount,
                saved: savedCount,
                total: totalLayers,
                status: 'cancelled',
                dataSource: targetDataSource
              });
            }
            
            return { processedLayers: processedCount, savedLayers: savedCount, totalLayers, cancelled: true };
          }
          
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
            // Check cancellation before each save
            const processingInfoBeforeSave = activeProcessing.get(cityData.name);
            if (!processingInfoBeforeSave || processingInfoBeforeSave.shouldCancel) {
              console.log(`Processing cancelled for ${cityData.name} before saving layer`);
              activeProcessing.delete(cityData.name);
              
              if (onProgressUpdate) {
                onProgressUpdate(cityData.name, {
                  processed: processedCount,
                  saved: savedCount,
                  total: totalLayers,
                  status: 'cancelled',
                  dataSource: targetDataSource
                });
              }
              
              return { processedLayers: processedCount, savedLayers: savedCount, totalLayers, cancelled: true };
            }
            
            const layerData = layerGroups[layerInfo.filename];
            
            if (layerData && layerData.features && layerData.features.length > 0) {
              // Save layers that have features
              await saveLayerFeatures(
                layerData.features,
                country,
                province,
                city,
                layerData.domain,
                layerInfo.filename,
                null
              );
              savedCount++;
              console.log(`Saved layer ${layerInfo.filename} with cropped features to ${targetDataSource}`);
            } else {
              console.log(`Layer ${layerInfo.filename} processed with 0 features (not saving to S3)`);
            }
            
            processedCount++;
            
            if (onProgressUpdate) {
              onProgressUpdate(cityData.name, {
                processed: processedCount,
                saved: savedCount,
                total: totalLayers,
                status: 'processing',
                dataSource: targetDataSource
              });
            }
          }

          console.log(`Completed batch processing (${processedCount}/${totalLayers} layers processed, ${savedCount} saved to ${targetDataSource})`);

          await new Promise(resolve => setTimeout(resolve, 2000));

        } catch (batchError) {
          console.warn(`Error processing batch:`, batchError);
          processedCount += batch.length;
          
          if (onProgressUpdate) {
            onProgressUpdate(cityData.name, {
              processed: processedCount,
              saved: savedCount,
              total: totalLayers,
              status: 'processing',
              dataSource: targetDataSource
            });
          }
        }
      }

      console.log(`Completed background processing for ${cityData.name} in ${targetDataSource}: ${processedCount}/${totalLayers} layers processed, ${savedCount} saved`);
      
      // Remove from active processing on successful completion
      activeProcessing.delete(cityData.name);
      
      if (onProgressUpdate) {
        onProgressUpdate(cityData.name, {
          processed: processedCount,
          saved: savedCount,
          total: totalLayers,
          status: 'complete',
          dataSource: targetDataSource
        });
      }
      
      return { processedLayers: processedCount, savedLayers: savedCount, totalLayers, cancelled: false };
    } finally {
      // Always restore the original data source prefix
      DATA_SOURCE_PREFIX = originalDataSource;
      console.log(`Restored data source prefix to: ${originalDataSource}`);
    }
  } catch (error) {
    console.error('Error in background processing:', error);
    activeProcessing.delete(cityData.name);
    throw error;
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
    const populationPrefix = `${DATA_SOURCE_PREFIX}/population/country=${normalizedCountry}/province=${normalizedProvince}/city=${normalizedCity}/`;
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
    const dataPrefix = `${DATA_SOURCE_PREFIX}/data/country=${normalizedCountry}/province=${normalizedProvince}/city=${normalizedCity}/`;
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

// Delete only city metadata from population bucket (not data layers)
export const deleteCityMetadata = async (country, province, city) => {
  try {
    const normalizedCity = normalizeName(city);
    const normalizedProvince = normalizeName(province);
    const normalizedCountry = normalizeName(country);

    console.log(`Deleting city metadata for: ${country}/${province}/${city}`);
    console.log(`Normalized: country=${normalizedCountry}, province=${normalizedProvince}, city=${normalizedCity}`);

    const objectsToDelete = [];

    // List and collect population data files only
    const populationPrefix = `${DATA_SOURCE_PREFIX}/population/country=${normalizedCountry}/province=${normalizedProvince}/city=${normalizedCity}/`;
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
          console.log(`Found population file to delete: ${obj.Key}`);
        });
      }
      
      populationContinuationToken = populationResponse.NextContinuationToken;
    } while (populationContinuationToken);

    console.log(`Total metadata files to delete: ${objectsToDelete.length}`);

    if (objectsToDelete.length > 0) {
      const deleteCommand = new DeleteObjectsCommand({
        Bucket: BUCKET_NAME,
        Delete: {
          Objects: objectsToDelete,
          Quiet: false,
        },
      });
      
      const deleteResponse = await s3Client.send(deleteCommand);
      
      if (deleteResponse.Deleted) {
        console.log(`Deleted ${deleteResponse.Deleted.length} metadata objects`);
      }
      
      if (deleteResponse.Errors && deleteResponse.Errors.length > 0) {
        console.error('Errors during metadata deletion:', deleteResponse.Errors);
      }
      
      console.log(`Successfully deleted metadata for ${city}`);
    } else {
      console.log(`No metadata files found to delete for ${city}`);
    }
  } catch (error) {
    console.error('Error deleting city metadata:', error);
    throw error;
  }
};

// Check if a city already exists in the population bucket
export const checkCityExists = async (country, province, city) => {
  try {
    await initializeWasm();
    
    const normalizedCountry = normalizeName(country);
    const normalizedProvince = normalizeName(province);
    const normalizedCity = normalizeName(city);
    
    const cityMetaKey = buildPath('population', country, province, city);
    
    try {
      const listCommand = new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: cityMetaKey,
        MaxKeys: 1,
      });
      
      const response = await s3Client.send(listCommand);
      const exists = response.Contents && response.Contents.length > 0;
      console.log(`City ${normalizedCountry}/${normalizedProvince}/${normalizedCity} exists: ${exists}`);
      return exists;
    } catch (error) {
      console.log(`City ${normalizedCountry}/${normalizedProvince}/${normalizedCity} does not exist:`, error.message);
      return false;
    }
  } catch (error) {
    console.error(`Error checking if city exists:`, error);
    return false;
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
      Prefix: `${DATA_SOURCE_PREFIX}/data/country=${normalizedCountry}/province=${normalizedProvince}/city=${normalizedCity}/`,
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
import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { readParquet, writeParquet, Table, WriterPropertiesBuilder, Compression } from 'parquet-wasm';
import { tableFromArrays, tableToIPC } from 'apache-arrow';
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
  },
});

const BUCKET_NAME = 'veraset-data-qoli-dev';

// Helper function to normalize names (lowercase, replace spaces with underscores)
const normalizeName = (name) => {
  return name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
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

// Get all cities from BOTH population and data buckets - FIXED
export const getAllCities = async () => {
  try {
    console.log('=== Scanning S3 buckets for cities (COMPLETELY FIXED) ===');
    
    const cities = new Map();
    
    // Scan population bucket for city_data.snappy.parquet files
    console.log('--- Scanning population bucket recursively ---');
    const populationFiles = await scanS3Directory('population/', 'city_data.snappy.parquet');
    
    for (const filePath of populationFiles) {
      console.log(`Processing population file: ${filePath}`);
      
      // Extract city info from path: population/country=canada/province=ontario/city=toronto/city_data.snappy.parquet
      const pathMatch = filePath.match(/population\/country=([^\/]+)\/province=([^\/]*)\/city=([^\/]+)\/city_data\.snappy\.parquet$/);
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
      const pathMatch = filePath.match(/data\/country=([^\/]+)\/province=([^\/]*)\/city=([^\/]+)\//);
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
const getCityData = async (country, province, city) => {
  try {
    await initializeWasm();
    
    console.log(`=== Loading city data for: ${country}/${province}/${city} ===`);
    
    // Load city metadata from population bucket
    const cityMetaKey = `population/country=${country}/province=${province}/city=${city}/city_data.snappy.parquet`;
    
    try {
      const getCommand = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: cityMetaKey,
      });
      
      const fileResponse = await s3Client.send(getCommand);
      const arrayBuffer = await fileResponse.Body.arrayBuffer();
      
      const data = readParquet(new Uint8Array(arrayBuffer));
      
      if (data && data.length > 0) {
        const row = data[0];
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

// Load city features for display - FIXED to properly handle GeoJSON geometry
export const loadCityFeatures = async (cityName, activeLayers) => {
  try {
    await initializeWasm();
    const parts = cityName.split(',').map(p => p.trim());
    if (parts.length < 2) return [];
    
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
    
    const features = [];
    const activeLayerNames = Object.keys(activeLayers).filter(layer => activeLayers[layer]);
    
    // Load features from individual layer files in data bucket
    for (const [domain, layers] of Object.entries(layerDefinitions)) {
      for (const layer of layers) {
        if (activeLayerNames.includes(layer.filename)) {
          try {
            const key = `data/country=${normalizedCountry}/province=${normalizedProvince}/city=${normalizedCity}/domain=${domain}/${layer.filename}.snappy.parquet`;
            
            const command = new GetObjectCommand({
              Bucket: BUCKET_NAME,
              Key: key,
            });
            
            const response = await s3Client.send(command);
            const arrayBuffer = await response.Body.arrayBuffer();
            
            const data = readParquet(new Uint8Array(arrayBuffer));
            
            for (const row of data) {
              let geometry = null;
              
              // Handle different geometry types with proper GeoJSON parsing
              if (row.geometry_coordinates) {
                try {
                  // Parse the stored GeoJSON geometry
                  const geoJsonGeometry = JSON.parse(row.geometry_coordinates);
                  if (geoJsonGeometry && geoJsonGeometry.type && geoJsonGeometry.coordinates) {
                    geometry = geoJsonGeometry;
                  }
                } catch (parseError) {
                  console.warn('Error parsing stored GeoJSON geometry:', parseError);
                  // Fallback to point if we have lat/lon
                  if (row.longitude && row.latitude) {
                    geometry = {
                      type: 'Point',
                      coordinates: [parseFloat(row.longitude), parseFloat(row.latitude)],
                    };
                  }
                }
              } else if (row.longitude && row.latitude) {
                // Fallback to point geometry
                geometry = {
                  type: 'Point',
                  coordinates: [parseFloat(row.longitude), parseFloat(row.latitude)],
                };
              }
              
              if (geometry) {
                features.push({
                  type: 'Feature',
                  geometry,
                  properties: {
                    feature_name: row.feature_name || 'Unnamed',
                    layer_name: row.layer_name,
                    domain_name: row.domain_name,
                  },
                });
              }
            }
          } catch (error) {
            console.warn(`No data found for layer ${layer.filename}:`, error);
          }
        }
      }
    }
    
    return features;
  } catch (error) {
    console.error('Error loading city features:', error);
    return [];
  }
};

// Save individual layer - FIXED to store proper GeoJSON geometry
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

// Background processing function - FIXED to properly handle worker results
export const processCityFeatures = async (cityData, country, province, city) => {
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
        
        // Save each layer group
        for (const [layerName, layerData] of Object.entries(layerGroups)) {
          if (layerData.features.length > 0) {
            await saveLayerFeatures(
              layerData.features,
              country,
              province,
              city,
              layerData.domain,
              layerName
            );
          }
          processedCount++;
        }
        
        // Add any layers that had no features
        batch.forEach(layerInfo => {
          if (!layerGroups[layerInfo.filename]) {
            processedCount++;
          }
        });

        console.log(`Completed batch processing (${processedCount}/${totalLayers} layers processed)`);

        // Small delay between batches
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (batchError) {
        console.warn(`Error processing batch:`, batchError);
        // Still increment counter for failed batch
        processedCount += batch.length;
      }
    }

    console.log(`Completed background processing for ${cityData.name}: ${processedCount}/${totalLayers} layers processed`);
    return { processedLayers: processedCount, totalLayers };
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
    if (parts.length < 2) return;

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

    const objectsToDelete = [];

    // List population data files
    const populationListCommand = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: `population/country=${normalizedCountry}/province=${normalizedProvince}/city=${normalizedCity}/`,
    });
    const populationResponse = await s3Client.send(populationListCommand);
    if (populationResponse.Contents) {
      populationResponse.Contents.forEach(obj => {
        objectsToDelete.push({ Key: obj.Key });
      });
    }

    // List data layer files
    const dataListCommand = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: `data/country=${normalizedCountry}/province=${normalizedProvince}/city=${normalizedCity}/`,
    });
    const dataResponse = await s3Client.send(dataListCommand);
    if (dataResponse.Contents) {
      dataResponse.Contents.forEach(obj => {
        objectsToDelete.push({ Key: obj.Key });
      });
    }

    if (objectsToDelete.length > 0) {
      const deleteCommand = new DeleteObjectsCommand({
        Bucket: BUCKET_NAME,
        Delete: {
          Objects: objectsToDelete,
        },
      });
      await s3Client.send(deleteCommand);
      console.log('City data deleted successfully from both population and data buckets');
    }
  } catch (error) {
    console.error('Error deleting city data:', error);
    throw error;
  }
};
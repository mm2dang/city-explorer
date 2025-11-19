import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { readParquet, writeParquet, WriterPropertiesBuilder, Compression } from 'parquet-wasm';
import { tableFromIPC } from 'apache-arrow';
import shpwrite from '@mapbox/shp-write';
import JSZip from 'jszip';
import { getDataSource } from './s3';

// Initialize S3 client
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

const BUCKET_NAME = process.env.REACT_APP_S3_BUCKET_NAME;

// Helper to normalize names
const normalizeName = (name) => {
  return name.toLowerCase().replace(/\s+/g, '_');
};

// Helper to format layer names
const formatLayerName = (layerName) => {
  return layerName
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('_');
};

// Helper to convert stream to ArrayBuffer
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

// Load layer data from S3
const loadLayerData = async (cityName, domain, layerName) => {
  try {
    console.log(`Loading from S3: city="${cityName}", domain="${domain}", layer="${layerName}"`);
    
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
    
    // Get current data source prefix from s3.js
    const DATA_SOURCE_PREFIX = getDataSource();
    console.log(`Using data source prefix: ${DATA_SOURCE_PREFIX}`);
    
    const possibleKeys = [
      `${DATA_SOURCE_PREFIX}/data/country=${normalizedCountry}/province=${normalizedProvince}/city=${normalizedCity}/domain=${domain}/${layerName}.snappy.parquet`,
    ];
    
    for (const key of possibleKeys) {
      try {
        console.log(`Trying key: ${key}`);
        const command = new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: key,
        });
        
        const response = await s3Client.send(command);
        const arrayBuffer = await streamToArrayBuffer(response.Body);
        const uint8Array = new Uint8Array(arrayBuffer);
        
        // Successfully loaded, parse the data
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
        
        console.log(`Successfully loaded ${data.length} rows from: ${key}`);
        return data;
        
      } catch (error) {
        if (error.Code === 'NoSuchKey' || error.name === 'NoSuchKey') {
          continue; // Try next key pattern
        }
        throw error; // Other errors should be thrown immediately
      }
    }
    
    // If we get here, none of the keys worked
    console.error('All key patterns failed. Tried:', possibleKeys);
    throw new Error(`Layer data not found. Tried ${possibleKeys.length} different paths.`);
    
  } catch (error) {
    console.error('Error loading layer data:', error);
    throw new Error(`Failed to load layer data: ${error.message}`);
  }
};

// Download file helper
const downloadFile = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

// Export as Parquet (original S3 format)
const exportAsParquet = async (data, layerName) => {
  try {
    // Import parquet-wasm initialization
    const { default: init } = await import('parquet-wasm');
    await init();
    
    // Convert data to Arrow Table format
    const columns = {};
    if (data.length > 0) {
      Object.keys(data[0]).forEach(key => {
        columns[key] = data.map(row => row[key]);
      });
    }
    
    const { tableFromArrays, tableToIPC } = await import('apache-arrow');
    const arrowTable = tableFromArrays(columns);
    const ipcBuffer = tableToIPC(arrowTable, 'stream');
    
    const { Table } = await import('parquet-wasm');
    const wasmTable = Table.fromIPCStream(ipcBuffer);
    
    // Write with Snappy compression
    const writerProperties = new WriterPropertiesBuilder()
      .setCompression(Compression.SNAPPY)
      .build();
    const buffer = writeParquet(wasmTable, writerProperties);
    
    const formattedName = formatLayerName(layerName);
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    downloadFile(blob, `${formattedName}.snappy.parquet`);
    
    console.log(`Exported ${data.length} rows as Parquet`);
  } catch (error) {
    console.error('Error exporting as Parquet:', error);
    throw new Error(`Failed to export as Parquet: ${error.message}`);
  }
};

// Export as CSV
const exportAsCSV = (data, layerName) => {
  try {
    if (data.length === 0) {
      throw new Error('No data to export');
    }
    
    // Get headers
    const headers = Object.keys(data[0]);
    
    // Create CSV content
    const csvRows = [];
    csvRows.push(headers.join(','));
    
    for (const row of data) {
      const values = headers.map(header => {
        const value = row[header];
        // Handle null/undefined
        if (value === null || value === undefined) return '';
        // Escape and quote strings that contain commas or quotes
        const stringValue = String(value);
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
      });
      csvRows.push(values.join(','));
    }
    
    const csvContent = csvRows.join('\n');
    const formattedName = formatLayerName(layerName);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    downloadFile(blob, `${formattedName}.csv`);
    
    console.log(`Exported ${data.length} rows as CSV`);
  } catch (error) {
    console.error('Error exporting as CSV:', error);
    throw new Error(`Failed to export as CSV: ${error.message}`);
  }
};

// Export as GeoJSON
const exportAsGeoJSON = (data, layerName) => {
  try {
    if (data.length === 0) {
      throw new Error('No data to export');
    }
    
    const features = [];
    
    for (const row of data) {
      let geometry = null;
      
      // Parse stored geometry
      if (row.geometry_coordinates) {
        try {
          geometry = JSON.parse(row.geometry_coordinates);
        } catch (e) {
          console.warn('Could not parse geometry:', e);
        }
      }
      
      // Fallback to point from longitude/latitude
      if (!geometry && row.longitude != null && row.latitude != null) {
        geometry = {
          type: 'Point',
          coordinates: [parseFloat(row.longitude), parseFloat(row.latitude)]
        };
      }
      
      if (geometry) {
        // Build properties (exclude geometry fields)
        const properties = {};
        for (const [key, value] of Object.entries(row)) {
          if (!['geometry_coordinates', 'geometry_type', 'longitude', 'latitude'].includes(key)) {
            properties[key] = value;
          }
        }
        
        features.push({
          type: 'Feature',
          geometry: geometry,
          properties: properties
        });
      }
    }
    
    const geojson = {
      type: 'FeatureCollection',
      features: features
    };
    
    const jsonContent = JSON.stringify(geojson, null, 2);
    const formattedName = formatLayerName(layerName);
    const blob = new Blob([jsonContent], { type: 'application/geo+json;charset=utf-8;' });
    downloadFile(blob, `${formattedName}.geojson`);
    
    console.log(`Exported ${features.length} features as GeoJSON`);
  } catch (error) {
    console.error('Error exporting as GeoJSON:', error);
    throw new Error(`Failed to export as GeoJSON: ${error.message}`);
  }
};

// Export as Shapefile
const exportAsShapefile = async (data, layerName) => {
  try {
    if (data.length === 0) {
      throw new Error('No data to export');
    }
    
    // Convert data to GeoJSON features first
    const features = [];
    
    for (const row of data) {
      let geometry = null;
      
      if (row.geometry_coordinates) {
        try {
          geometry = JSON.parse(row.geometry_coordinates);
        } catch (e) {
          console.warn('Could not parse geometry:', e);
        }
      }
      
      if (!geometry && row.longitude != null && row.latitude != null) {
        geometry = {
          type: 'Point',
          coordinates: [parseFloat(row.longitude), parseFloat(row.latitude)]
        };
      }
      
      if (geometry) {
        const properties = {};
        for (const [key, value] of Object.entries(row)) {
          if (!['geometry_coordinates', 'geometry_type', 'longitude', 'latitude'].includes(key)) {
            // Shapefile attribute names limited to 10 characters
            const shortKey = key.substring(0, 10);
            // Convert null to empty string for shapefile compatibility
            properties[shortKey] = value === null || value === undefined ? '' : value;
          }
        }
        
        features.push({
          type: 'Feature',
          geometry: geometry,
          properties: properties
        });
      }
    }
    
    if (features.length === 0) {
      throw new Error('No valid features with geometry found');
    }
    
    // Group features by geometry type (shapefiles require same geometry type)
    const byGeometryType = {};
    features.forEach(f => {
      const geomType = f.geometry.type;
      if (!byGeometryType[geomType]) {
        byGeometryType[geomType] = [];
      }
      byGeometryType[geomType].push(f);
    });
    
    // Create zip file manually
    const zip = new JSZip();
    
    // Format layer name properly
    const formattedLayerName = formatLayerName(layerName);
    
    // Process each geometry type separately
    for (const [geomType, geomFeatures] of Object.entries(byGeometryType)) {
      const geomCollection = {
        type: 'FeatureCollection',
        features: geomFeatures
      };
      
      // Generate shapefile using shp-write
      try {
        const shpData = shpwrite.zip(geomCollection, {
          outputType: 'blob',
          compression: 'DEFLATE'
        });
        
        // Create geometry suffix (e.g., points, polygons, lines)
        const suffix = geomType === 'Point' ? 'points' : 
                      geomType === 'Polygon' ? 'polygons' : 
                      geomType === 'LineString' ? 'lines' : 'features';
        
        // Add to main zip with format: LayerName_geometrytype
        zip.file(`${formattedLayerName}_${suffix}.zip`, shpData);
      } catch (shpError) {
        console.warn(`Could not create shapefile for ${geomType}:`, shpError);
      }
    }
    
    // Generate final zip
    const zipBlob = await zip.generateAsync({ 
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: {
        level: 6
      }
    });
    
    downloadFile(zipBlob, `${formattedLayerName}.zip`);
    
    console.log(`Exported ${features.length} features as Shapefile (${Object.keys(byGeometryType).length} geometry types)`);
  } catch (error) {
    console.error('Error exporting as Shapefile:', error);
    throw new Error(`Failed to export as Shapefile: ${error.message}`);
  }
};

// Main export function
export const exportLayer = async (cityName, domain, layerName, format) => {
  try {
    console.log(`Exporting layer ${layerName} as ${format}`);
    
    // Load data from S3
    const data = await loadLayerData(cityName, domain, layerName);
    
    if (!data || data.length === 0) {
      throw new Error('No data found for this layer');
    }
    
    // Export based on format
    switch (format.toLowerCase()) {
      case 'parquet':
        await exportAsParquet(data, layerName);
        break;
      case 'csv':
        exportAsCSV(data, layerName);
        break;
      case 'geojson':
        exportAsGeoJSON(data, layerName);
        break;
      case 'shapefile':
        await exportAsShapefile(data, layerName);
        break;
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
    
    console.log(`Successfully exported ${layerName} as ${format}`);
  } catch (error) {
    console.error(`Export failed:`, error);
    throw error;
  }
};

// Export all layers organized by city and domain
export const exportAllLayers = async (cityName, availableLayersByDomain, format = 'all') => {
  try {
    console.log(`Exporting all layers as ${format}...`);
    
    // Create main zip file
    const mainZip = new JSZip();
    
    // Use city name as folder name
    const cityFolder = cityName;

    // Export city boundary if available
    if (cityName && availableLayersByDomain) {
      try {
        // Find the city object to get boundary
        const city = window.citiesData?.find(c => c.name === cityName);
        
        if (city && city.boundary) {
          console.log('Adding city boundary to export...');
          
          // Parse boundary (it's stored as WKT string)
          const boundaryGeometry = JSON.parse(city.boundary);
          
          // Format city name for folder
          const cityFolder = cityName;
          
          // Export based on selected format(s)
          const formatsToExport = format === 'all' 
            ? ['parquet', 'csv', 'geojson', 'shapefile'] 
            : [format];
          
          for (const exportFormat of formatsToExport) {
            if (exportFormat === 'geojson') {
              // Create GeoJSON for boundary
              const boundaryGeoJSON = {
                type: 'FeatureCollection',
                features: [{
                  type: 'Feature',
                  geometry: boundaryGeometry,
                  properties: {
                    name: cityName,
                    feature_type: 'city_boundary'
                  }
                }]
              };
              
              const jsonContent = JSON.stringify(boundaryGeoJSON, null, 2);
              mainZip.file(`${cityFolder}/city_boundary.geojson`, jsonContent);
              console.log('Added boundary as GeoJSON');
            }
            
            if (exportFormat === 'shapefile') {
              // Create shapefile for boundary
              try {
                const boundaryFeature = {
                  type: 'FeatureCollection',
                  features: [{
                    type: 'Feature',
                    geometry: boundaryGeometry,
                    properties: {
                      name: cityName,
                      type: 'boundary'
                    }
                  }]
                };
                
                const shpData = shpwrite.zip(boundaryFeature, {
                  outputType: 'blob',
                  compression: 'DEFLATE'
                });
                
                mainZip.file(`${cityFolder}/city_boundary.zip`, shpData);
                console.log('Added boundary as Shapefile');
              } catch (shpError) {
                console.warn('Could not create boundary shapefile:', shpError);
              }
            }
            
            if (exportFormat === 'csv') {
              // Create CSV with WKT representation
              const wktString = JSON.stringify(boundaryGeometry);
              const csvContent = `name,geometry_type,geometry_wkt\n"${cityName}","${boundaryGeometry.type}","${wktString.replace(/"/g, '""')}"`;
              mainZip.file(`${cityFolder}/city_boundary.csv`, csvContent);
              console.log('Added boundary as CSV');
            }
            
            if (exportFormat === 'parquet') {
              // Create Parquet with boundary data
              try {
                const { default: init } = await import('parquet-wasm');
                await init();
                
                const boundaryData = [{
                  name: cityName,
                  geometry_type: boundaryGeometry.type,
                  geometry_coordinates: JSON.stringify(boundaryGeometry)
                }];
                
                const columns = {};
                Object.keys(boundaryData[0]).forEach(key => {
                  columns[key] = boundaryData.map(row => row[key]);
                });
                
                const { tableFromArrays, tableToIPC } = await import('apache-arrow');
                const arrowTable = tableFromArrays(columns);
                const ipcBuffer = tableToIPC(arrowTable, 'stream');
                
                const { Table } = await import('parquet-wasm');
                const wasmTable = Table.fromIPCStream(ipcBuffer);
                
                const writerProperties = new WriterPropertiesBuilder()
                  .setCompression(Compression.SNAPPY)
                  .build();
                const buffer = writeParquet(wasmTable, writerProperties);
                
                mainZip.file(`${cityFolder}/city_boundary.snappy.parquet`, buffer);
                console.log('Added boundary as Parquet');
              } catch (parquetError) {
                console.warn('Could not create boundary parquet:', parquetError);
              }
            }
          }
        } else {
          console.warn('No boundary available for city:', cityName);
        }
      } catch (boundaryError) {
        console.error('Error exporting city boundary:', boundaryError);
        // Continue with layer export even if boundary export fails
      }
    }
    
    // Process each domain
    for (const [domain, layers] of Object.entries(availableLayersByDomain)) {
      // Format domain name (capitalize first letter)
      const domainFolder = domain.charAt(0).toUpperCase() + domain.slice(1);
      
      // Create domain folder path
      const domainPath = `${cityFolder}/${domainFolder}`;
      
      // Process each layer in the domain
      for (const layer of layers) {
        try {
          console.log(`Loading ${layer.name} from ${domain}...`);
          
          // Load data from S3
          const data = await loadLayerData(cityName, domain, layer.name);
          
          if (!data || data.length === 0) {
            console.warn(`No data found for layer ${layer.name}, skipping...`);
            continue;
          }
          
          // Format layer name
          const formattedLayerName = formatLayerName(layer.name);
          
          // Export based on selected format or all formats
          const formatsToExport = format === 'all' 
            ? ['parquet', 'csv', 'geojson', 'shapefile'] 
            : [format];
          
          for (const exportFormat of formatsToExport) {
            if (exportFormat === 'parquet') {
              try {
                const { default: init } = await import('parquet-wasm');
                await init();
                
                const columns = {};
                if (data.length > 0) {
                  Object.keys(data[0]).forEach(key => {
                    columns[key] = data.map(row => row[key]);
                  });
                }
                
                const { tableFromArrays, tableToIPC } = await import('apache-arrow');
                const arrowTable = tableFromArrays(columns);
                const ipcBuffer = tableToIPC(arrowTable, 'stream');
                
                const { Table } = await import('parquet-wasm');
                const wasmTable = Table.fromIPCStream(ipcBuffer);
                
                const writerProperties = new WriterPropertiesBuilder()
                  .setCompression(Compression.SNAPPY)
                  .build();
                const buffer = writeParquet(wasmTable, writerProperties);
                
                mainZip.file(`${domainPath}/${formattedLayerName}.snappy.parquet`, buffer);
              } catch (error) {
                console.warn(`Could not export ${layer.name} as Parquet:`, error);
              }
            }
            
            // 2. CSV
            if (exportFormat === 'csv') {
              try {
                const headers = Object.keys(data[0]);
                const csvRows = [headers.join(',')];
                
                for (const row of data) {
                  const values = headers.map(header => {
                    const value = row[header];
                    if (value === null || value === undefined) return '';
                    const stringValue = String(value);
                    if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
                      return `"${stringValue.replace(/"/g, '""')}"`;
                    }
                    return stringValue;
                  });
                  csvRows.push(values.join(','));
                }
                
                const csvContent = csvRows.join('\n');
                mainZip.file(`${domainPath}/${formattedLayerName}.csv`, csvContent);
              } catch (error) {
                console.warn(`Could not export ${layer.name} as CSV:`, error);
              }
            }
            
            // 3. GeoJSON
            if (exportFormat === 'geojson') {
              try {
                const features = [];
                
                for (const row of data) {
                  let geometry = null;
                  
                  if (row.geometry_coordinates) {
                    try {
                      geometry = JSON.parse(row.geometry_coordinates);
                    } catch (e) {
                      // Skip invalid geometry
                    }
                  }
                  
                  if (!geometry && row.longitude != null && row.latitude != null) {
                    geometry = {
                      type: 'Point',
                      coordinates: [parseFloat(row.longitude), parseFloat(row.latitude)]
                    };
                  }
                  
                  if (geometry) {
                    const properties = {};
                    for (const [key, value] of Object.entries(row)) {
                      if (!['geometry_coordinates', 'geometry_type', 'longitude', 'latitude'].includes(key)) {
                        properties[key] = value;
                      }
                    }
                    
                    features.push({
                      type: 'Feature',
                      geometry: geometry,
                      properties: properties
                    });
                  }
                }
                
                if (features.length > 0) {
                  const geojson = {
                    type: 'FeatureCollection',
                    features: features
                  };
                  
                  const jsonContent = JSON.stringify(geojson, null, 2);
                  mainZip.file(`${domainPath}/${formattedLayerName}.geojson`, jsonContent);
                }
              } catch (error) {
                console.warn(`Could not export ${layer.name} as GeoJSON:`, error);
              }
            }
            
            // 4. Shapefile
            if (exportFormat === 'shapefile') {
              try {
                const features = [];
                
                for (const row of data) {
                  let geometry = null;
                  
                  if (row.geometry_coordinates) {
                    try {
                      geometry = JSON.parse(row.geometry_coordinates);
                    } catch (e) {
                      // Skip invalid geometry
                    }
                  }
                  
                  if (!geometry && row.longitude != null && row.latitude != null) {
                    geometry = {
                      type: 'Point',
                      coordinates: [parseFloat(row.longitude), parseFloat(row.latitude)]
                    };
                  }
                  
                  if (geometry) {
                    const properties = {};
                    for (const [key, value] of Object.entries(row)) {
                      if (!['geometry_coordinates', 'geometry_type', 'longitude', 'latitude'].includes(key)) {
                        const shortKey = key.substring(0, 10);
                        properties[shortKey] = value === null || value === undefined ? '' : value;
                      }
                    }
                    
                    features.push({
                      type: 'Feature',
                      geometry: geometry,
                      properties: properties
                    });
                  }
                }
                
                if (features.length > 0) {
                  const byGeometryType = {};
                  features.forEach(f => {
                    const geomType = f.geometry.type;
                    if (!byGeometryType[geomType]) {
                      byGeometryType[geomType] = [];
                    }
                    byGeometryType[geomType].push(f);
                  });
                  
                  // Create shapefiles for each geometry type
                  for (const [geomType, geomFeatures] of Object.entries(byGeometryType)) {
                    const geomCollection = {
                      type: 'FeatureCollection',
                      features: geomFeatures
                    };
                    
                    try {
                      const shpData = shpwrite.zip(geomCollection, {
                        outputType: 'blob',
                        compression: 'DEFLATE'
                      });
                      
                      const suffix = geomType === 'Point' ? 'points' : 
                                    geomType === 'Polygon' ? 'polygons' : 
                                    geomType === 'LineString' ? 'lines' : 'features';
                      
                      // Add shapefile zip directly to domain folder
                      mainZip.file(`${domainPath}/${formattedLayerName}_${suffix}.zip`, shpData);
                    } catch (shpError) {
                      console.warn(`Could not create shapefile for ${layer.name} ${geomType}:`, shpError);
                    }
                  }
                }
              } catch (error) {
                console.warn(`Could not export ${layer.name} as Shapefile:`, error);
              }
            }
          }
          
        } catch (layerError) {
          console.error(`Error processing layer ${layer.name}:`, layerError);
          // Continue with next layer
        }
      }
    }
    
    // Generate final zip file
    const finalZip = await mainZip.generateAsync({ 
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: {
        level: 6
      }
    });
    
    // Download with city name and format suffix
    const formatSuffix = format === 'all' ? 'all_formats' : format;
    downloadFile(finalZip, `${cityName.replace(/,/g, '_')}_${formatSuffix}.zip`);
    
    console.log('Successfully exported all layers!');
  } catch (error) {
    console.error('Error exporting all layers:', error);
    throw new Error(`Failed to export all layers: ${error.message}`);
  }
};
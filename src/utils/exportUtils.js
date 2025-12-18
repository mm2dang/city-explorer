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

// Helper to format file names
const createSafeFilename = (name) => {
  return name
    .replace(/\s+/g, '_')
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '');
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
    
    const possibleKeys = [
      `${DATA_SOURCE_PREFIX}/data/country=${normalizedCountry}/province=${normalizedProvince}/city=${normalizedCity}/domain=${domain}/${layerName}.snappy.parquet`,
    ];
    
    for (const key of possibleKeys) {
      try {
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
    
  } catch (error) {
    console.error('Error exporting as Shapefile:', error);
    throw new Error(`Failed to export as Shapefile: ${error.message}`);
  }
};

// Main export function
export const exportLayer = async (cityName, domain, layerName, format) => {
  try {    
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

  } catch (error) {
    console.error(`Export failed:`, error);
    throw error;
  }
};

// Export all layers organized by city and domain
export const exportAllLayers = async (cityData, availableLayersByDomain, format = 'all') => {
  try {    
    // Create main zip file
    const mainZip = new JSZip();
    
    // Use city name as folder name
    const cityFolder = cityData.name;
    
    // Determine which formats to export
    const formatsToExport = format === 'all' 
      ? ['parquet', 'csv', 'geojson', 'shapefile'] 
      : [format];
    
    // Export neighbourhoods if available
    if (cityData && cityData.neighbourhoods && cityData.neighbourhood_names) {
      try {        
        // Parse the neighbourhoods data
        let neighbourhoods;
        try {
          neighbourhoods = JSON.parse(cityData.neighbourhoods);
          
          let neighbourhoodFeatures;
          
          if (Array.isArray(neighbourhoods)) {
            neighbourhoodFeatures = neighbourhoods;
          } else if (neighbourhoods.type === 'FeatureCollection' && neighbourhoods.features) {
            neighbourhoodFeatures = neighbourhoods.features.map(f => f.geometry);
          } else {
            console.warn('Unknown neighbourhood format:', neighbourhoods);
            throw new Error('Unknown neighbourhood data format');
          }
          
          const neighbourhoodNames = JSON.parse(cityData.neighbourhood_names);
          
          if (neighbourhoodFeatures && neighbourhoodFeatures.length > 0) {
            
            // Export each neighbourhood as a separate file
            for (let i = 0; i < neighbourhoodFeatures.length; i++) {
              const geometry = neighbourhoodFeatures[i];
              const neighbourhoodName = neighbourhoodNames[i] || `neighbourhood_${i + 1}`;
              const safeName = createSafeFilename(neighbourhoodName);
              
              for (const exportFormat of formatsToExport) {
                if (exportFormat === 'geojson') {
                  const neighbourhoodGeoJSON = {
                    type: 'FeatureCollection',
                    features: [{
                      type: 'Feature',
                      geometry: geometry,
                      properties: {
                        name: neighbourhoodName,
                        neighbourhood_id: i,
                        feature_type: 'neighbourhood'
                      }
                    }]
                  };
                  const jsonContent = JSON.stringify(neighbourhoodGeoJSON, null, 2);
                  mainZip.file(`${cityFolder}/Neighbourhoods/${safeName}.geojson`, jsonContent);
                }
                
                if (exportFormat === 'shapefile') {
                  try {
                    const neighbourhoodFeature = {
                      type: 'FeatureCollection',
                      features: [{
                        type: 'Feature',
                        geometry: geometry,
                        properties: {
                          name: neighbourhoodName.substring(0, 10),
                          id: i,
                          type: 'neighbrhd'
                        }
                      }]
                    };
                    
                    const shpData = shpwrite.zip(neighbourhoodFeature, {
                      outputType: 'blob',
                      compression: 'DEFLATE'
                    });
                    
                    mainZip.file(`${cityFolder}/Neighbourhoods/${safeName}.zip`, shpData);
                  } catch (shpError) {
                    console.warn(`Could not create neighbourhood shapefile for ${neighbourhoodName}:`, shpError);
                  }
                }
                
                if (exportFormat === 'csv') {
                  const wktString = JSON.stringify(geometry);
                  const csvContent = `name,neighbourhood_id,geometry_type,geometry_wkt\n"${neighbourhoodName.replace(/"/g, '""')}",${i},"${geometry.type}","${wktString.replace(/"/g, '""')}"`;
                  mainZip.file(`${cityFolder}/Neighbourhoods/${safeName}.csv`, csvContent);
                }
                
                if (exportFormat === 'parquet') {
                  try {
                    const { default: init } = await import('parquet-wasm');
                    await init();
                    
                    const neighbourhoodData = [{
                      name: neighbourhoodName,
                      neighbourhood_id: i,
                      geometry_type: geometry.type,
                      geometry_coordinates: JSON.stringify(geometry)
                    }];
                    
                    const columns = {};
                    Object.keys(neighbourhoodData[0]).forEach(key => {
                      columns[key] = neighbourhoodData.map(row => row[key]);
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
                    
                    mainZip.file(`${cityFolder}/Neighbourhoods/${safeName}.snappy.parquet`, buffer);
                  } catch (parquetError) {
                    console.warn(`Could not create neighbourhood parquet for ${neighbourhoodName}:`, parquetError);
                  }
                }
              }
            }
          } else {
            console.warn('No neighbourhood features found');
          }
        } catch (parseError) {
          console.error('Error parsing neighbourhoods:', parseError);
          console.error('Raw neighbourhoods data (first 200 chars):', 
            cityData.neighbourhoods ? cityData.neighbourhoods.substring(0, 200) : 'null');
          throw parseError;
        }
      } catch (neighbourhoodError) {
        console.error('Error exporting neighbourhoods:', neighbourhoodError);
        console.error('Stack:', neighbourhoodError.stack);
        // Continue with other exports even if neighbourhood export fails
      }
    }
    
    // Export city boundary if available
    if (cityData && cityData.boundary) {
      try {
        
        // Parse boundary
        const boundaryGeometry = JSON.parse(cityData.boundary);
        
        // Export based on selected format(s)
        for (const exportFormat of formatsToExport) {
          if (exportFormat === 'geojson') {
            // Create GeoJSON for boundary
            const boundaryGeoJSON = {
              type: 'FeatureCollection',
              features: [{
                type: 'Feature',
                geometry: boundaryGeometry,
                properties: {
                  name: cityData.name,
                  feature_type: 'city_boundary'
                }
              }]
            };
            const jsonContent = JSON.stringify(boundaryGeoJSON, null, 2);
            mainZip.file(`${cityFolder}/city_boundary.geojson`, jsonContent);
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
                    name: cityData.name,
                    type: 'boundary'
                  }
                }]
              };
              
              const shpData = shpwrite.zip(boundaryFeature, {
                outputType: 'blob',
                compression: 'DEFLATE'
              });
              
              mainZip.file(`${cityFolder}/city_boundary.zip`, shpData);
            } catch (shpError) {
              console.warn('Could not create boundary shapefile:', shpError);
            }
          }
          
          if (exportFormat === 'csv') {
            // Create CSV with WKT representation
            const wktString = JSON.stringify(boundaryGeometry);
            const csvContent = `name,geometry_type,geometry_wkt\n"${cityData.name}","${boundaryGeometry.type}","${wktString.replace(/"/g, '""')}"`;
            mainZip.file(`${cityFolder}/city_boundary.csv`, csvContent);
          }
          
          if (exportFormat === 'parquet') {
            // Create Parquet with boundary data
            try {
              const { default: init } = await import('parquet-wasm');
              await init();
              
              const boundaryData = [{
                name: cityData.name,
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
            } catch (parquetError) {
              console.warn('Could not create boundary parquet:', parquetError);
            }
          }
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
          // Load data from S3
          const data = await loadLayerData(cityData.name, domain, layer.name);
          
          if (!data || data.length === 0) {
            console.warn(`  No data found for layer ${layer.name}, skipping...`);
            continue;
          }
          
          // Format layer name
          const formattedLayerName = formatLayerName(layer.name);
          
          // Export based on selected format or all formats
          for (const exportFormat of formatsToExport) {
            // 1. Parquet
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
    const filename = `${cityData.name.replace(/,/g, '_')}_${formatSuffix}.zip`;
    
    downloadFile(finalZip, filename);
    
  } catch (error) {
    console.error('Error exporting all layers:', error);
    console.error('Stack:', error.stack);
    throw new Error(`Failed to export all layers: ${error.message}`);
  }
};
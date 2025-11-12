import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { MapContainer, TileLayer, FeatureGroup, useMap } from 'react-leaflet';
import { EditControl } from 'react-leaflet-draw';
import L from 'leaflet';
import * as shp from 'shapefile';
import proj4 from 'proj4';
import { searchOSM, fetchWikipediaData, fetchOSMBoundary } from '../utils/osm';
import { saveCityData, processCityFeatures, checkCityExists, moveCityData, deleteCityData, deleteCityMetadata, getAvailableLayersForCity } from '../utils/s3';
import { getSDGRegion } from '../utils/regions';
import 'leaflet-draw/dist/leaflet.draw.css';
import '../styles/AddCityWizard.css';
import JSZip from 'jszip';

const MapController = ({ center, boundary, onBoundaryLoad }) => {
  const map = useMap();

  useEffect(() => {
    if (boundary) {
      console.log('MapController: boundary changed, fitting to bounds');
      try {
        const geoJsonLayer = L.geoJSON(boundary);
        const bounds = geoJsonLayer.getBounds();
        if (bounds.isValid()) {
          map.fitBounds(bounds, { 
            padding: [50, 50],
            maxZoom: 15
          });
        } else {
          console.warn('MapController: Invalid bounds, using center');
          map.setView(center || [51.505, -0.09], 12);
        }
      } catch (error) {
        console.error('MapController: Error fitting bounds:', error);
        map.setView(center || [51.505, -0.09], 12);
      }
    } else if (center && center[0] && center[1]) {
      console.log('MapController: No boundary, using center');
      map.setView(center, 12);
    }
  }, [center, boundary, map]);

  useEffect(() => {
    if (boundary && onBoundaryLoad) {
      console.log('MapController: Calling onBoundaryLoad');
      onBoundaryLoad(map);
    }
  }, [boundary, onBoundaryLoad, map]);

  return null;
};

// Helper function to reproject a geometry from any CRS to WGS84
const reprojectGeometry = (geometry, prjWkt, crsFromGeoJSON = null) => {
  const wgs84 = 'EPSG:4326';
  
  let sourceCRS = null;
  
  if (prjWkt) {
    try {
      sourceCRS = prjWkt;
    } catch (e) {
      console.warn('Could not parse PRJ file:', e);
    }
  } else if (crsFromGeoJSON) {
    try {
      sourceCRS = crsFromGeoJSON;
    } catch (e) {
      console.warn('Could not parse GeoJSON CRS:', e);
    }
  }
  
  if (!sourceCRS) {
    const firstCoord = geometry.type === 'Polygon' 
      ? geometry.coordinates[0][0] 
      : geometry.coordinates[0][0][0];
    
    const x = firstCoord[0];
    const y = firstCoord[1];
    
    if (x >= -180 && x <= 180 && y >= -90 && y <= 90) {
      console.log('Coordinates appear to be in WGS84, no reprojection needed');
      return geometry;
    }
    
    console.warn('No CRS information provided. Assuming WGS 1984 UTM Zone 19S (EPSG:32719)');
    sourceCRS = 'EPSG:32719';
  }
  
  const transformCoord = (coord) => {
    try {
      return proj4(sourceCRS, wgs84, coord);
    } catch (e) {
      console.error('Error transforming coordinate:', coord, e);
      throw e;
    }
  };
  
  const transformRing = (ring) => {
    return ring.map(coord => transformCoord(coord));
  };
  
  if (geometry.type === 'Polygon') {
    return {
      type: 'Polygon',
      coordinates: geometry.coordinates.map(ring => transformRing(ring))
    };
  } else if (geometry.type === 'MultiPolygon') {
    return {
      type: 'MultiPolygon',
      coordinates: geometry.coordinates.map(polygon => 
        polygon.map(ring => transformRing(ring))
      )
    };
  }
  
  return geometry;
};

/**
 * Merges multiple Polygon and MultiPolygon geometries into a single MultiPolygon
 */
const mergeGeometries = (geometries) => {
  if (!geometries || geometries.length === 0) {
    throw new Error('No geometries to merge');
  }

  // If only one geometry, normalize it to MultiPolygon if needed
  if (geometries.length === 1) {
    const geom = geometries[0];
    if (geom.type === 'MultiPolygon') {
      return geom;
    } else if (geom.type === 'Polygon') {
      return {
        type: 'MultiPolygon',
        coordinates: [geom.coordinates]
      };
    }
  }

  // Collect all polygon coordinates
  const allPolygons = [];
  
  for (const geometry of geometries) {
    if (geometry.type === 'Polygon') {
      allPolygons.push(geometry.coordinates);
    } else if (geometry.type === 'MultiPolygon') {
      allPolygons.push(...geometry.coordinates);
    } else {
      console.warn(`Skipping unsupported geometry type: ${geometry.type}`);
    }
  }

  if (allPolygons.length === 0) {
    throw new Error('No valid Polygon or MultiPolygon geometries found');
  }

  return {
    type: 'MultiPolygon',
    coordinates: allPolygons
  };
};

const AddCityWizard = ({ editingCity, onComplete, onCancel, dataSource = 'city', processingProgress = {} }) => {
  const [step, setStep] = useState(1);
  const [cityName, setCityName] = useState('');
  const [province, setProvince] = useState('');
  const [country, setCountry] = useState('');
  const [osmSuggestions, setOsmSuggestions] = useState([]);
  const [selectedCity, setSelectedCity] = useState(null);
  const [uploadError, setUploadError] = useState('');
  const [wikiData, setWikiData] = useState({ population: null, size: null });
  const [wikipediaUrl, setWikipediaUrl] = useState(null);
  const [boundary, setBoundary] = useState(null);
  const [originalBoundary, setOriginalBoundary] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [wikiLoading, setWikiLoading] = useState(false);
  const [shouldProcessFeatures, setShouldProcessFeatures] = useState(false);
  const [hasExistingFeatures, setHasExistingFeatures] = useState(true);
  const drawRef = useRef(null);
  const mapRef = useRef(null);

  // Parse city name parts properly handling 4+ parts
  const parseCityName = (displayName) => {
    const parts = displayName.split(',').map(part => part.trim());
    if (parts.length >= 4) {
      return {
        city: parts[0],
        province: parts[parts.length - 2],
        country: parts[parts.length - 1]
      };
    } else if (parts.length === 3) {
      return {
        city: parts[0],
        province: parts[1],
        country: parts[2]
      };
    } else if (parts.length === 2) {
      return {
        city: parts[0],
        province: '',
        country: parts[1]
      };
    } else {
      return {
        city: parts[0] || '',
        province: '',
        country: ''
      };
    }
  };

  useEffect(() => {
    if (editingCity) {
      // Existing logic for editing cities remains
      return;
    }
    
    // For new cities, default to true if data source is OSM
    if (dataSource === 'osm') {
      setShouldProcessFeatures(true);
    } else {
      setShouldProcessFeatures(false);
    }
  }, [dataSource, editingCity]);

  useEffect(() => {
    const checkExistingFeatures = async () => {
      if (editingCity) {
        const parsed = parseCityName(editingCity.name);
        setCityName(parsed.city);
        setProvince(parsed.province);
        setCountry(parsed.country);
        if (editingCity.boundary) {
          const parsedBoundary = JSON.parse(editingCity.boundary);
          setBoundary(parsedBoundary);
          setOriginalBoundary(parsedBoundary);
        }
        setWikiData({
          population: editingCity.population,
          size: editingCity.size
        });
        setSelectedCity({
          display_name: editingCity.name,
          lat: editingCity.latitude,
          lon: editingCity.longitude
        });
        
        try {
          console.log('Checking if features exist for:', editingCity.name);
          const layers = await getAvailableLayersForCity(editingCity.name);
          const hasFeatures = Object.keys(layers).length > 0;
          console.log(`Found ${Object.keys(layers).length} layers for ${editingCity.name}`);
          setHasExistingFeatures(hasFeatures);
          
          // If no features exist and data source is OSM, default to checked
          if (!hasFeatures && dataSource === 'osm') {
            setShouldProcessFeatures(true);
          }
        } catch (error) {
          console.error('Error checking for existing features:', error);
          setHasExistingFeatures(false);
          
          // If error checking features and data source is OSM, default to checked
          if (dataSource === 'osm') {
            setShouldProcessFeatures(true);
          }
        }
      }
    };
    
    checkExistingFeatures();
  }, [editingCity, dataSource]);
  
  const handleSearch = async () => {
    if (!cityName.trim()) return;
    setSearchLoading(true);
    try {
      const results = await searchOSM(cityName, province, country);
      setOsmSuggestions(results.slice(0, 10));
    } catch (error) {
      console.error('Error searching OSM:', error);
      alert('Error searching for cities. Please try again.');
    } finally {
      setSearchLoading(false);
    }
  };

  const handleSelectCity = async (city) => {
    setSelectedCity(city);
    const parsed = parseCityName(city.display_name);
    setCityName(parsed.city);
    setProvince(parsed.province);
    setCountry(parsed.country);
  
    // Only set boundary from OSM if no boundary exists yet
    // This prevents overwriting uploaded/drawn boundaries
    if (!boundary) {
      let boundaryData = null;
      if (city.geojson && ['Polygon', 'MultiPolygon'].includes(city.geojson.type)) {
        boundaryData = city.geojson;
      } else if (city.osm_type === 'relation' && city.osm_id) {
        try {
          boundaryData = await fetchOSMBoundary(city.osm_id);
        } catch (error) {
          console.error('Error fetching boundary:', error);
        }
      }
  
      if (boundaryData) {
        setBoundary(boundaryData);
      }
    }
  
    // Fetch Wikipedia data with URL
    setWikiLoading(true);
    try {
      const wikiResult = await fetchWikipediaData(city.display_name);
      setWikiData({
        population: wikiResult.population,
        size: wikiResult.size
      });
      setWikipediaUrl(wikiResult.url || null);
    } catch (error) {
      console.error('Error fetching Wikipedia data:', error);
      setWikiData({ population: null, size: null });
      setWikipediaUrl(null);
    } finally {
      setWikiLoading(false);
    }
  };

  const handleDrawCreated = (e) => {
    const layer = e.layer;
    const newGeometry = layer.toGeoJSON().geometry;
    
    // Validate new boundary
    const validation = validateBoundary(newGeometry);
    if (!validation.valid) {
      setUploadError(`Invalid boundary: ${validation.error}`);
      return;
    }
    
    // If there's an existing boundary, merge the new polygon with it
    if (boundary) {
      console.log('Adding new polygon to existing boundary');
      try {
        const mergedGeometry = mergeGeometries([boundary, newGeometry]);
        console.log(`Merged new polygon with existing boundary`);
        
        setBoundary(mergedGeometry);
        setUploadError('');
        
        // Add the new layer to the draw control
        if (drawRef.current) {
          drawRef.current.addLayer(layer);
        }
        
        // Update coordinates
        const center = calculateBoundaryCenter(mergedGeometry);
        if (center && selectedCity) {
          setSelectedCity(prev => ({
            ...prev,
            lat: center.lat,
            lon: center.lon
          }));
        }
      } catch (mergeError) {
        console.error('Error merging new polygon:', mergeError);
        setUploadError(`Error adding polygon: ${mergeError.message}`);
      }
    } else {
      // No existing boundary, just set the new one
      if (drawRef.current) {
        drawRef.current.clearLayers();
        drawRef.current.addLayer(layer);
      }
      
      setBoundary(newGeometry);
      setUploadError('');
      
      // Update coordinates
      const center = calculateBoundaryCenter(newGeometry);
      if (center && selectedCity) {
        setSelectedCity(prev => ({
          ...prev,
          lat: center.lat,
          lon: center.lon
        }));
      }
    }
  };

  const handleDrawEdited = (e) => {
    const layers = e.layers;
    const allGeometries = [];
    
    layers.eachLayer((layer) => {
      const geometry = layer.toGeoJSON().geometry;
      
      // Validate boundary before adding
      const validation = validateBoundary(geometry);
      if (!validation.valid) {
        setUploadError(`Invalid boundary after edit: ${validation.error}`);
        return;
      }
      
      allGeometries.push(geometry);
    });
    
    if (allGeometries.length === 0) {
      setUploadError('No valid geometries after editing');
      return;
    }
    
    // Merge all edited geometries back into a single MultiPolygon
    try {
      const mergedGeometry = mergeGeometries(allGeometries);
      console.log(`Merged ${allGeometries.length} edited geometries into ${mergedGeometry.type}`);
      
      setBoundary(mergedGeometry);
      setUploadError('');
      
      // Update coordinates based on edited boundary
      const center = calculateBoundaryCenter(mergedGeometry);
      if (center && selectedCity) {
        setSelectedCity(prev => ({
          ...prev,
          lat: center.lat,
          lon: center.lon
        }));
      }
    } catch (mergeError) {
      console.error('Error merging edited geometries:', mergeError);
      setUploadError(`Error processing edited boundary: ${mergeError.message}`);
    }
  };

  const handleDrawDeleted = (e) => {
    const remainingLayers = [];
    
    if (drawRef.current) {
      drawRef.current.eachLayer((layer) => {
        const geometry = layer.toGeoJSON().geometry;
        remainingLayers.push(geometry);
      });
    }
    
    if (remainingLayers.length === 0) {
      console.log('All polygons deleted');
      setBoundary(null);
      setUploadError('');
    } else {
      try {
        const mergedGeometry = mergeGeometries(remainingLayers);
        console.log(`Merged ${remainingLayers.length} remaining geometries`);
        
        setBoundary(mergedGeometry);
        setUploadError('');
        
        // Update coordinates
        const center = calculateBoundaryCenter(mergedGeometry);
        if (center && selectedCity) {
          setSelectedCity(prev => ({
            ...prev,
            lat: center.lat,
            lon: center.lon
          }));
        }
      } catch (mergeError) {
        console.error('Error merging remaining geometries:', mergeError);
        setUploadError(`Error processing boundary: ${mergeError.message}`);
      }
    }
  };

  const handleBoundaryLoad = useCallback((map) => {
    if (boundary && drawRef.current && map) {
      console.log('Loading boundary on map:', boundary);
      console.log('Boundary type:', boundary.type);
      drawRef.current.clearLayers();
      
      try {
        const feature = {
          type: 'Feature',
          geometry: boundary,
          properties: {}
        };
        
        // Convert GeoJSON to Leaflet editable layer with teal styling
        const geoJsonLayer = L.geoJSON(feature, {
          style: {
            color: '#0891b2',
            weight: 2,
            fillColor: '#0891b2',
            fillOpacity: 0.2
          }
        });
        
        // Extract the actual Leaflet layer(s) and add them individually as editable layers
        geoJsonLayer.eachLayer((layer) => {
          if (layer.setStyle) {
            layer.setStyle({
              color: '#0891b2',
              weight: 2,
              fillColor: '#0891b2',
              fillOpacity: 0.2
            });
          }
          
          // For MultiPolygon with multiple parts, handle each polygon separately
          if (boundary.type === 'MultiPolygon') {
            console.log(`MultiPolygon with ${boundary.coordinates.length} parts detected`);
            
            // Split MultiPolygon into individual Polygons for editing
            boundary.coordinates.forEach((polygonCoords, index) => {
              const singlePolygon = L.polygon(
                polygonCoords.map(ring => ring.map(coord => [coord[1], coord[0]])),
                {
                  color: '#0891b2',
                  weight: 2,
                  fillColor: '#0891b2',
                  fillOpacity: 0.2
                }
              );
              
              // Store the polygon index so we can reconstruct later
              singlePolygon._polygonIndex = index;
              drawRef.current.addLayer(singlePolygon);
            });
          } else {
            // Single Polygon - add normally
            drawRef.current.addLayer(layer);
          }
        });
        
        const bounds = geoJsonLayer.getBounds();
        console.log('Bounds object:', {
          isValid: bounds.isValid(),
          southWest: bounds.getSouthWest(),
          northEast: bounds.getNorthEast(),
          center: bounds.getCenter()
        });
        
        if (bounds.isValid()) {
          console.log('Fitting bounds:', bounds);
          map.fitBounds(bounds, { 
            padding: [50, 50],
            maxZoom: 15 
          });
        } else {
          console.warn('Invalid bounds for boundary');
        }
      } catch (error) {
        console.error('Error displaying boundary:', error);
      }
    }
  }, [boundary]);

  const validateBoundary = (geometry) => {
    if (!geometry || !geometry.coordinates) {
      return { valid: false, error: 'No geometry data' };
    }
  
    if (geometry.type === 'Polygon') {
      for (let i = 0; i < geometry.coordinates.length; i++) {
        const ring = geometry.coordinates[i];
        if (!Array.isArray(ring) || ring.length < 4) {
          return {
            valid: false,
            error: `Ring ${i} has ${ring.length} positions. Each LinearRing must have at least 4 positions (minimum valid polygon).`
          };
        }
        // Check if ring is closed
        const first = ring[0];
        const last = ring[ring.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) {
          return {
            valid: false,
            error: `Ring ${i} is not closed. First and last coordinates must be the same.`
          };
        }
      }
    } else if (geometry.type === 'MultiPolygon') {
      for (let i = 0; i < geometry.coordinates.length; i++) {
        for (let j = 0; j < geometry.coordinates[i].length; j++) {
          const ring = geometry.coordinates[i][j];
          if (!Array.isArray(ring) || ring.length < 4) {
            return {
              valid: false,
              error: `Polygon ${i}, Ring ${j} has ${ring.length} positions. Each LinearRing must have at least 4 positions.`
            };
          }
          const first = ring[0];
          const last = ring[ring.length - 1];
          if (first[0] !== last[0] || first[1] !== last[1]) {
            return {
              valid: false,
              error: `Polygon ${i}, Ring ${j} is not closed.`
            };
          }
        }
      }
    }
  
    return { valid: true };
  };

  const calculateBoundaryCenter = (geometry) => {
    try {
      let coords = [];
      
      if (geometry.type === 'Polygon') {
        coords = geometry.coordinates[0];
      } else if (geometry.type === 'MultiPolygon') {
        coords = geometry.coordinates[0][0];
      } else {
        return null;
      }
  
      if (!coords || coords.length < 3) {
        return null;
      }
  
      let sumLat = 0, sumLon = 0;
      for (const coord of coords) {
        sumLon += coord[0];
        sumLat += coord[1];
      }
  
      return {
        lat: (sumLat / coords.length).toString(),
        lon: (sumLon / coords.length).toString()
      };
    } catch (error) {
      console.error('Error calculating boundary center:', error);
      return null;
    }
  };

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (!files || files.length === 0) return;
  
    setUploadError('');
    setIsProcessing(true);
  
    try {
      // Check if a ZIP file was uploaded
      const zipFile = files.find(f => f.name.toLowerCase().endsWith('.zip'));
      
      if (zipFile) {
        console.log('Processing ZIP file:', zipFile.name);
        
        try {
          const zip = await JSZip.loadAsync(zipFile);
          console.log('ZIP contents:', Object.keys(zip.files));
          
          // Extract shapefile components from ZIP
          let shpBuffer = null;
          let dbfBuffer = null;
          let prjWkt = null;
          
          for (const [filename, zipEntry] of Object.entries(zip.files)) {
            if (zipEntry.dir) continue;
            
            const lowerName = filename.toLowerCase();
            
            if (lowerName.endsWith('.shp')) {
              console.log('Found .shp file in ZIP:', filename);
              shpBuffer = await zipEntry.async('arraybuffer');
            } else if (lowerName.endsWith('.dbf')) {
              console.log('Found .dbf file in ZIP:', filename);
              dbfBuffer = await zipEntry.async('arraybuffer');
            } else if (lowerName.endsWith('.prj')) {
              console.log('Found .prj file in ZIP:', filename);
              prjWkt = await zipEntry.async('text');
            }
          }
          
          if (!shpBuffer) {
            setUploadError('ZIP file must contain a .shp file');
            setIsProcessing(false);
            return;
          }
          
          if (!prjWkt) {
            console.warn('No PRJ file found in ZIP - will assume WGS 1984 UTM Zone 19S (EPSG:32719)');
          }
          
          // Process the shapefile
          await processShapefile(shpBuffer, dbfBuffer, prjWkt);
          
        } catch (zipError) {
          console.error('Error processing ZIP file:', zipError);
          setUploadError(`Error processing ZIP file: ${zipError.message}`);
          setIsProcessing(false);
          return;
        }
      } else {
        // Original file processing logic (GeoJSON or separate shapefile components)
        const geojsonFile = files.find(f => {
          const name = f.name.toLowerCase();
          return name.endsWith('.geojson') || name.endsWith('.json');
        });
        
        const shpFile = files.find(f => f.name.toLowerCase().endsWith('.shp'));
  
        if (geojsonFile) {
          await processGeoJSONFile(geojsonFile);
        } else if (shpFile) {
          const shpBuffer = await shpFile.arrayBuffer();
          
          let dbfBuffer = null;
          const dbfFile = files.find(f => f.name.toLowerCase().endsWith('.dbf'));
          if (dbfFile) {
            dbfBuffer = await dbfFile.arrayBuffer();
          }
      
          let prjWkt = null;
          const prjFile = files.find(f => f.name.toLowerCase().endsWith('.prj'));
          if (prjFile) {
            prjWkt = await prjFile.text();
            console.log('Found PRJ file:', prjWkt);
          } else {
            console.warn('No PRJ file found - will assume WGS 1984 UTM Zone 19S (EPSG:32719)');
          }
          
          await processShapefile(shpBuffer, dbfBuffer, prjWkt);
        } else {
          const fileExtensions = files.map(f => f.name.toLowerCase().split('.').pop());
          
          if (fileExtensions.some(ext => ['shx', 'dbf', 'prj', 'cpg', 'qmd'].includes(ext))) {
            setUploadError(
              'You selected Shapefile component files. Please also select the .shp file ' +
              '(you can select multiple files at once) or upload them all in a .zip file.'
            );
          } else {
            const uploadedExt = fileExtensions[0];
            setUploadError(
              `Unsupported file format: .${uploadedExt}. ` +
              'Please upload a GeoJSON (.geojson, .json), Shapefile (.shp with optional .dbf, .shx files), or ZIP file containing shapefiles.'
            );
          }
          setIsProcessing(false);
        }
      }
    } catch (error) {
      console.error('Error processing file:', error);
      setUploadError(`Error processing file: ${error.message}`);
      setIsProcessing(false);
    }
  
    e.target.value = '';
  };
  
  // Helper function to process GeoJSON files
  const processGeoJSONFile = async (geojsonFile) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const geojson = JSON.parse(event.target.result);
        let geometries = [];
        let crsInfo = null;
  
        if (geojson.crs && geojson.crs.properties && geojson.crs.properties.name) {
          const crsName = geojson.crs.properties.name;
          if (crsName.includes('EPSG')) {
            const epsgMatch = crsName.match(/EPSG[:\s]+(\d+)/i);
            if (epsgMatch) {
              crsInfo = `EPSG:${epsgMatch[1]}`;
              console.log('Found CRS in GeoJSON:', crsInfo);
            }
          }
        }
  
        // Extract all geometries
        if (geojson.type === 'FeatureCollection') {
          if (!geojson.features || geojson.features.length === 0) {
            setUploadError('FeatureCollection is empty');
            setIsProcessing(false);
            return;
          }
          geometries = geojson.features
            .map(f => f.geometry)
            .filter(g => ['Polygon', 'MultiPolygon'].includes(g.type));
          
          if (geometries.length === 0) {
            setUploadError('No Polygon or MultiPolygon geometries found in FeatureCollection');
            setIsProcessing(false);
            return;
          }
        } 
        else if (geojson.type === 'Feature') {
          if (!['Polygon', 'MultiPolygon'].includes(geojson.geometry.type)) {
            setUploadError('Feature must contain Polygon or MultiPolygon geometry');
            setIsProcessing(false);
            return;
          }
          geometries = [geojson.geometry];
        } 
        else if (['Polygon', 'MultiPolygon'].includes(geojson.type)) {
          geometries = [geojson];
        } else {
          setUploadError('Please upload a valid Polygon or MultiPolygon GeoJSON');
          setIsProcessing(false);
          return;
        }
  
        // Validate each geometry
        for (let i = 0; i < geometries.length; i++) {
          if (!geometries[i].coordinates || geometries[i].coordinates.length === 0) {
            setUploadError(`Geometry ${i + 1} has invalid or empty coordinates`);
            setIsProcessing(false);
            return;
          }
  
          const validation = validateBoundary(geometries[i]);
          if (!validation.valid) {
            setUploadError(`Geometry ${i + 1}: ${validation.error}`);
            setIsProcessing(false);
            return;
          }
        }
  
        // Reproject if needed
        if (crsInfo && crsInfo !== 'EPSG:4326') {
          try {
            geometries = geometries.map(geom => 
              reprojectGeometry(geom, null, crsInfo)
            );
            console.log('Reprojected GeoJSON geometries to WGS84');
          } catch (reprojError) {
            console.error('Reprojection error:', reprojError);
            setUploadError(`Error reprojecting coordinates: ${reprojError.message}`);
            setIsProcessing(false);
            return;
          }
        }
  
        // Merge all geometries into single MultiPolygon
        let mergedGeometry;
        try {
          mergedGeometry = mergeGeometries(geometries);
          console.log(`Merged ${geometries.length} geometries into MultiPolygon with ${mergedGeometry.coordinates.length} polygon(s)`);
        } catch (mergeError) {
          console.error('Merge error:', mergeError);
          setUploadError(`Error merging geometries: ${mergeError.message}`);
          setIsProcessing(false);
          return;
        }
  
        console.log('Successfully loaded and merged GeoJSON boundary:', mergedGeometry);
        
        setBoundary(mergedGeometry);
        
        // Update coordinates based on uploaded boundary
        const center = calculateBoundaryCenter(mergedGeometry);
        if (center && selectedCity) {
          setSelectedCity(prev => ({
            ...prev,
            lat: center.lat,
            lon: center.lon
          }));
        }
        
        if (drawRef.current) {
          drawRef.current.clearLayers();
        }
        
        setIsProcessing(false);
      } catch (error) {
        console.error('Error parsing GeoJSON:', error);
        setUploadError('Invalid GeoJSON file. Please check the format.');
        setIsProcessing(false);
      }
    };
    reader.onerror = () => {
      setUploadError('Error reading GeoJSON file');
      setIsProcessing(false);
    };
    reader.readAsText(geojsonFile);
  };
  
  // Helper function to process Shapefile
  const processShapefile = async (shpBuffer, dbfBuffer, prjWkt) => {
    try {
      const geojson = await shp.read(shpBuffer, dbfBuffer);
      
      if (!geojson || !geojson.features || geojson.features.length === 0) {
        setUploadError('Shapefile is empty or invalid');
        setIsProcessing(false);
        return;
      }
  
      // Extract all polygon/multipolygon geometries
      let geometries = geojson.features
        .map(f => f.geometry)
        .filter(g => ['Polygon', 'MultiPolygon'].includes(g.type));
      
      if (geometries.length === 0) {
        setUploadError('Shapefile must contain at least one Polygon or MultiPolygon geometry');
        setIsProcessing(false);
        return;
      }
  
      // Validate each geometry
      for (let i = 0; i < geometries.length; i++) {
        if (!geometries[i].coordinates || geometries[i].coordinates.length === 0) {
          setUploadError(`Geometry ${i + 1} has invalid or empty coordinates`);
          setIsProcessing(false);
          return;
        }
  
        const validation = validateBoundary(geometries[i]);
        if (!validation.valid) {
          setUploadError(`Geometry ${i + 1}: ${validation.error}`);
          setIsProcessing(false);
          return;
        }
      }
  
      console.log(`Original Shapefile contains ${geometries.length} polygon(s)`);
      
      // Reproject all geometries
      try {
        geometries = geometries.map(geom => 
          reprojectGeometry(geom, prjWkt, null)
        );
        console.log('Reprojected all geometries to WGS84');
      } catch (reprojError) {
        console.error('Reprojection error:', reprojError);
        setUploadError(`Error reprojecting coordinates: ${reprojError.message}`);
        setIsProcessing(false);
        return;
      }
  
      // Merge all geometries into single MultiPolygon
      let mergedGeometry;
      try {
        mergedGeometry = mergeGeometries(geometries);
        console.log(`Merged ${geometries.length} geometries into MultiPolygon with ${mergedGeometry.coordinates.length} polygon(s)`);
      } catch (mergeError) {
        console.error('Merge error:', mergeError);
        setUploadError(`Error merging geometries: ${mergeError.message}`);
        setIsProcessing(false);
        return;
      }
  
      setBoundary(mergedGeometry);
      
      // Update coordinates based on uploaded boundary
      const center = calculateBoundaryCenter(mergedGeometry);
      if (center && selectedCity) {
        setSelectedCity(prev => ({
          ...prev,
          lat: center.lat,
          lon: center.lon
        }));
      }
      
      if (drawRef.current) {
        drawRef.current.clearLayers();
      }
      
      setIsProcessing(false);
    } catch (error) {
      console.error('Error parsing Shapefile:', error);
      setUploadError(`Error parsing Shapefile: ${error.message}. Please ensure the file is valid.`);
      setIsProcessing(false);
    }
  };

  const hasBoundaryChanged = () => {
    if (!editingCity || !originalBoundary || !boundary) {
      return true;
    }
    
    try {
      return JSON.stringify(originalBoundary) !== JSON.stringify(boundary);
    } catch (error) {
      console.warn('Error comparing boundaries:', error);
      return true;
    }
  };

  const handleSubmit = async () => {
    if (!cityName.trim() || !selectedCity || !boundary) {
      alert('Please complete all required fields');
      return;
    }
  
    // Final boundary validation
    const validation = validateBoundary(boundary);
    if (!validation.valid) {
      alert(`Invalid boundary: ${validation.error}`);
      return;
    }
  
    // Check if city is currently processing
    if (editingCity) {
      const processingKey = `${editingCity.name}@${dataSource}`;
      const progress = processingProgress[processingKey];
      const isProcessing = progress && progress.status === 'processing';
      
      if (isProcessing && !window.confirm(
        `This city is currently being processed in ${dataSource === 'osm' ? 'OpenStreetMap' : 'Uploaded'} data source. Editing will cancel processing and delete any layers already processed in this data source only. Continue?`
      )) {
        return;
      }
    }
  
    setIsProcessing(true);
    
    const targetDataSource = dataSource;
    
    try {
      console.log('Submitting city with data source:', targetDataSource);
      
      const fullName = [cityName, province, country].filter(Boolean).join(', ');
      
      const isRename = editingCity && editingCity.name !== fullName;
      
      // Check if new name already exists (only if renaming)
      if (isRename) {
        const existingCity = await checkCityExists(country, province, cityName);
        if (existingCity) {
          alert(`A city with this name already exists: ${fullName}\n\nPlease use a different name or edit the existing city.`);
          setIsProcessing(false);
          return;
        }
      }
      
      // For new cities, check if it exists
      if (!editingCity) {
        const existingCity = await checkCityExists(country, province, cityName);
        if (existingCity) {
          alert(`A city with this name already exists: ${fullName}\n\nPlease use a different name or edit the existing city.`);
          setIsProcessing(false);
          return;
        }
      }
      
      const sdgRegion = getSDGRegion(country);
  
      // Convert population properly - remove commas and any non-numeric characters
      let populationValue = null;
      if (wikiData.population) {
        const popStr = String(wikiData.population).replace(/[^0-9]/g, '');
        if (popStr && popStr.length > 0) {
          const parsed = parseInt(popStr, 10);
          if (!isNaN(parsed) && parsed > 0) {
            populationValue = parsed;
          }
        }
      }
  
      // Convert size properly - remove commas and keep decimals
      let sizeValue = null;
      if (wikiData.size) {
        const sizeStr = String(wikiData.size).replace(/[^0-9.]/g, '');
        if (sizeStr && sizeStr.length > 0) {
          const parsed = parseFloat(sizeStr);
          if (!isNaN(parsed) && parsed > 0) {
            sizeValue = parsed;
          }
        }
      }
  
      // Calculate coordinates from the current boundary (uploaded/drawn)
      // This ensures coordinates match the actual boundary being saved
      const center = calculateBoundaryCenter(boundary);
      const finalLon = center ? parseFloat(center.lon) : parseFloat(selectedCity.lon);
      const finalLat = center ? parseFloat(center.lat) : parseFloat(selectedCity.lat);
  
      const cityData = {
        name: fullName,
        longitude: finalLon,
        latitude: finalLat,
        boundary: JSON.stringify(boundary),
        population: populationValue,
        size: sizeValue,
        sdg_region: sdgRegion
      };
  
      console.log('City data to save:', cityData);
      console.log('Target data source:', targetDataSource);
  
      if (editingCity) {
        const oldParsed = parseCityName(editingCity.name);
        
        if (isRename) {
          console.log('City renamed, moving data and saving new metadata to:', targetDataSource);
          
          // First, save the new city data
          await saveCityData(cityData, country, province, cityName);
          
          // Then move the data layers
          await moveCityData(
            oldParsed.country,
            oldParsed.province,
            oldParsed.city,
            country,
            province,
            cityName
          );
          
          // Finally, delete the old city metadata
          await deleteCityData(editingCity.name);
          
        } else {
          // Just updating metadata, not renaming
          console.log('Updating city metadata without rename - deleting old metadata first...');
          
          // Delete old metadata from population bucket only
          await deleteCityMetadata(country, province, cityName);
          
          // Save new metadata
          await saveCityData(cityData, country, province, cityName);
        }
        
        // Process features if user checked the option (regardless of boundary change)
        if (shouldProcessFeatures) {
          // Pass cityData and request reprocessing with captured data source
          await onComplete(cityData, (progressHandler) => {
            setTimeout(async () => {
              try {
                await processCityFeatures(
                  cityData, 
                  country, 
                  province, 
                  cityName,
                  progressHandler,
                  targetDataSource
                );
                console.log('Background processing completed for', fullName);
              } catch (error) {
                console.error('Background processing error:', error);
              }
            }, 1000);
          }, true); 
        } else {
          // Just metadata update, no reprocessing
          await onComplete(cityData, null, true);
        }
      } else {
        // New city
        console.log('Adding new city to data source:', targetDataSource);
        await saveCityData(cityData, country, province, cityName);
        
        // Only process if user checked the option
        if (shouldProcessFeatures) {
          await onComplete(cityData, (progressHandler) => {
            setTimeout(async () => {
              try {
                await processCityFeatures(
                  cityData, 
                  country, 
                  province, 
                  cityName,
                  progressHandler,
                  targetDataSource 
                );
                console.log('Background processing completed for', fullName);
              } catch (error) {
                console.error('Background processing error:', error);
              }
            }, 1000);
          }, false); 
        } else {
          await onComplete(cityData, null, false); 
        }
      }
  
    } catch (error) {
      console.error('Error saving city:', error);
      alert(`Error saving city: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  };
  
  const nextStep = () => setStep(step + 1);
  const prevStep = () => setStep(step - 1);

  const mapCenter = selectedCity ? [parseFloat(selectedCity.lat), parseFloat(selectedCity.lon)] : [51.505, -0.09];

  return (
    <motion.div
      className="wizard-container"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
    >
      <div className="wizard-header">
        <h2>{editingCity ? 'Edit City' : 'Add New City'}</h2>
        <button className="close-btn" onClick={onCancel}>
          <i className="fas fa-times"></i>
        </button>
      </div>

      <div className="wizard-steps">
        <div className={`step ${step >= 1 ? 'active' : ''}`}>1. Search</div>
        <div className={`step ${step >= 2 ? 'active' : ''}`}>2. Details</div>
        <div className={`step ${step >= 3 ? 'active' : ''}`}>3. Boundary</div>
      </div>

      <div className="wizard-content">
        {step === 1 && (
          <div className="step-content">
            <h3>Search for a City</h3>
            <div className="form-group">
              <input
                type="text"
                placeholder="City name *"
                value={cityName}
                onChange={(e) => setCityName(e.target.value)}
                className="form-input"
              />
            </div>
            <div className="form-group">
              <input
                type="text"
                placeholder="Province/State"
                value={province}
                onChange={(e) => setProvince(e.target.value)}
                className="form-input"
              />
            </div>
            <div className="form-group">
              <input
                type="text"
                placeholder="Country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="form-input"
              />
            </div>
            <motion.button
              className="search-btn"
              onClick={handleSearch}
              disabled={!cityName.trim() || searchLoading}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              {searchLoading ? (
                <>
                  <i className="fas fa-spinner fa-spin"></i>
                  Searching...
                </>
              ) : (
                <>
                  <i className="fas fa-search"></i>
                  Search OpenStreetMap
                </>
              )}
            </motion.button>

            {osmSuggestions.length > 0 && (
              <div className="suggestions">
                <h4>Select a city:</h4>
                {osmSuggestions.map((city) => (
                  <motion.div
                    key={city.place_id}
                    className={`suggestion ${selectedCity?.place_id === city.place_id ? 'selected' : ''}`}
                    onClick={() => handleSelectCity(city)}
                    whileHover={{ backgroundColor: '#f0f9ff' }}
                  >
                    {city.display_name}
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        )}

        {step === 2 && selectedCity && (
          <div className="step-content">
            <h3>City Details</h3>
            <div className="city-info">
              <h4>{selectedCity.display_name}</h4>
              <p>Lat: {selectedCity.lat}, Lon: {selectedCity.lon}</p>
            </div>
            <div className="form-group">
              <label>Population</label>
              <input
                type="number"
                placeholder="Population"
                value={wikiData.population || ''}
                onChange={(e) => setWikiData({ ...wikiData, population: e.target.value })}
                className="form-input"
              />
              {wikiLoading && (
                <div className="loading-indicator">
                  <i className="fas fa-spinner fa-spin"></i>
                  Fetching from Wikipedia...
                </div>
              )}
            </div>
            <div className="form-group">
              <label>Size (km²)</label>
              <input
                type="number"
                step="0.01"
                placeholder="Area in km²"
                value={wikiData.size || ''}
                onChange={(e) => setWikiData({ ...wikiData, size: e.target.value })}
                className="form-input"
              />
            </div>
            
            {wikipediaUrl && (
              <div style={{ 
                marginTop: '20px', 
                paddingTop: '15px', 
                borderTop: '1px solid #e5e7eb' 
              }}>
                <a 
                  href={wikipediaUrl} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  style={{
                    color: '#0891b2',
                    textDecoration: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '14px',
                    fontWeight: '500'
                  }}
                  onMouseOver={(e) => e.currentTarget.style.textDecoration = 'underline'}
                  onMouseOut={(e) => e.currentTarget.style.textDecoration = 'none'}
                >
                  <i className="fab fa-wikipedia-w"></i>
                  View Wikipedia page
                  <i className="fas fa-external-link-alt" style={{ fontSize: '12px' }}></i>
                </a>
              </div>
            )}
          </div>
        )}

        {step === 3 && selectedCity && (
          <div className="step-content">
            <h3>Define City Boundary</h3>
            {uploadError && (
              <div className="error-message" style={{ 
                backgroundColor: '#fee', 
                border: '1px solid #fcc',
                borderRadius: '4px',
                padding: '10px',
                marginBottom: '15px',
                color: '#c33'
              }}>
                <i className="fas fa-exclamation-circle"></i> {uploadError}
              </div>
            )}
            <div className="boundary-controls">
              <label className="upload-btn">
                <i className="fas fa-upload"></i>
                Upload File
                <input
                  type="file"
                  accept=".geojson,.json,.shp,.shx,.dbf,.prj,.zip"
                  onChange={handleFileUpload}
                  multiple
                  style={{ display: 'none' }}
                />
              </label>
              <span className="or-text">or draw on map</span>
            </div>
            <div className="boundary-controls">
              <div style={{ fontSize: '12px', color: '#666', marginTop: '8px' }}>
                <i className="fas fa-info-circle"></i> Upload GeoJSON (.geojson, .json), Shapefile (.shp + optional .dbf, .shx, .prj), or ZIP file containing all shapefile components. 
                For separate shapefiles, select all files at once. If no .prj file is provided, assumes WGS 1984 UTM Zone 19S (EPSG:32719).
              </div>
            </div>
            <div className="map-container-wizard">
              <MapContainer
                ref={mapRef}
                center={mapCenter}
                zoom={12}
                style={{ height: '400px', width: '100%' }}
              >
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution='&copy; OpenStreetMap contributors'
                />
                <MapController
                  center={mapCenter}
                  boundary={boundary}
                  onBoundaryLoad={handleBoundaryLoad}
                />
                <FeatureGroup ref={drawRef}>
                <EditControl
                  position="topright"
                  onCreated={handleDrawCreated}
                  onEdited={handleDrawEdited}
                  onDeleted={handleDrawDeleted}
                  draw={{
                    rectangle: false,
                    circle: false,
                    circlemarker: false,
                    marker: false,
                    polyline: false,
                    polygon: {
                      allowIntersection: false,
                      drawError: {
                        color: '#e74c3c',
                        message: 'Overlapping polygons are not allowed'
                      }
                    }
                  }}
                  edit={{
                    remove: true,
                    edit: true
                  }}
                />
                </FeatureGroup>
              </MapContainer>
            </div>
            {!boundary && (
              <p className="boundary-help">
                Draw a polygon on the map or upload a GeoJSON file to define the city boundary.
              </p>
            )}
            
            {/* Feature processing checkbox */}
            <div style={{ 
              marginTop: '20px', 
              paddingTop: '15px', 
              borderTop: '1px solid #e5e7eb',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px'
            }}>
              <input
                type="checkbox"
                id="process-features"
                checked={shouldProcessFeatures}
                onChange={(e) => setShouldProcessFeatures(e.target.checked)}
                style={{ 
                  marginTop: '3px', 
                  cursor: 'pointer',
                  width: '16px',
                  height: '16px'
                }}
                disabled={editingCity && hasExistingFeatures && !hasBoundaryChanged()}
              />
              <label 
                htmlFor="process-features" 
                style={{ 
                  fontSize: '14px', 
                  color: '#374151',
                  cursor: editingCity && hasExistingFeatures && !hasBoundaryChanged() ? 'not-allowed' : 'pointer',
                  opacity: editingCity && hasExistingFeatures && !hasBoundaryChanged() ? 0.6 : 1,
                  flex: 1
                }}
              >
                {editingCity && hasExistingFeatures && !hasBoundaryChanged() ? (
                  <>
                    <strong>Process OpenStreetMap features</strong>
                    <br />
                    <span style={{ fontSize: '12px', color: '#6b7280' }}>
                      Boundary unchanged - existing feature data will be preserved
                    </span>
                  </>
                ) : editingCity && !hasExistingFeatures ? (
                  shouldProcessFeatures ? (
                    <>
                      <strong>Process OpenStreetMap features</strong>
                      <br />
                      <span style={{ fontSize: '12px', color: '#6b7280' }}>
                        No existing features found. Fetch and process city features (roads, buildings, amenities, etc.) from OpenStreetMap. 
                        This may take several minutes depending on city size.
                      </span>
                    </>
                  ) : (
                    <>
                      <strong>Skip OpenStreetMap feature processing</strong>
                      <br />
                      <span style={{ fontSize: '12px', color: '#6b7280' }}>
                        No existing features found. You can add features later or manually upload custom layers.
                        The city will continue to show "Pending" status.
                      </span>
                    </>
                  )
                ) : shouldProcessFeatures ? (
                  <>
                    <strong>Process OpenStreetMap features</strong>
                    <br />
                    <span style={{ fontSize: '12px', color: '#6b7280' }}>
                      Fetch and process city features (roads, buildings, amenities, etc.) from OpenStreetMap. 
                      This may take several minutes depending on city size.
                    </span>
                  </>
                ) : (
                  <>
                    <strong>Skip OpenStreetMap feature processing</strong>
                    <br />
                    <span style={{ fontSize: '12px', color: '#6b7280' }}>
                      Only save the city boundary. You can add features later or manually upload custom layers.
                      The city will appear with "Pending" status.
                    </span>
                  </>
                )}
              </label>
            </div>
          </div>
        )}
      </div>

      <div className="wizard-footer">
        <div className="footer-buttons">
          {step > 1 && (
            <motion.button
              className="btn btn-secondary"
              onClick={prevStep}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <i className="fas fa-arrow-left"></i>
              Previous
            </motion.button>
          )}
          {step < 3 ? (
            <motion.button
              className="btn btn-primary"
              onClick={nextStep}
              disabled={step === 1 && !selectedCity}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              Next
              <i className="fas fa-arrow-right"></i>
            </motion.button>
          ) : (
            <motion.button
              className="btn btn-success"
              onClick={handleSubmit}
              disabled={!boundary || isProcessing}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              {isProcessing ? (
                <>
                  <i className="fas fa-spinner fa-spin"></i>
                  {editingCity ? 'Updating...' : 'Adding...'}
                </>
              ) : (
                <>
                  <i className="fas fa-check"></i>
                  {editingCity ? 'Update City' : 'Add City'}
                </>
              )}
            </motion.button>
          )}
        </div>
      </div>
    </motion.div>
  );
};

export default AddCityWizard;
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
      map.setView(center, 12);
    }

    // Store boundary in map container for center control
    const mapContainer = map.getContainer();
    if (boundary) {
      mapContainer.dataset.boundary = JSON.stringify(boundary);
    } else {
      delete mapContainer.dataset.boundary;
    }
    
    // Add center map control if it doesn't exist
    if (!map._centerControl) {
      const centerControl = new CenterMapControl();
      map.addControl(centerControl);
      map._centerControl = centerControl;
    }
  }, [center, boundary, map]);

  useEffect(() => {
    if (boundary && onBoundaryLoad) {
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

const CenterMapControl = L.Control.extend({
  options: { position: 'topleft' },

  onAdd: function(map) {
    const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom');
    container.style.background = 'rgba(255, 255, 255, 0.95)';
    container.style.backdropFilter = 'blur(10px)';
    container.style.border = '1px solid rgba(226, 232, 240, 0.8)';
    container.style.color = '#374151';
    container.style.fontSize = '18px';
    container.style.width = '34px';
    container.style.height = '34px';
    container.style.lineHeight = '32px';
    container.style.borderRadius = '8px';
    container.style.margin = '2px';
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.justifyContent = 'center';
    container.style.cursor = 'pointer';
    container.style.transition = 'all 0.2s';
    container.style.position = 'relative';
    container.style.left = '10px';
    container.innerHTML = '<i class="fas fa-expand-arrows-alt" style="font-size: 16px; color: #374151; transition: color 0.2s;"></i>';
    
    container.onmouseover = () => {
      container.style.background = 'white';
      container.style.color = '#0891b2';
      container.style.transform = 'scale(1.05)';
      container.querySelector('i').style.color = '#0891b2';
    };
    container.onmouseout = () => {
      container.style.background = 'rgba(255, 255, 255, 0.95)';
      container.style.color = '#374151';
      container.style.transform = 'scale(1)';
      container.querySelector('i').style.color = '#374151';
    };

    L.DomEvent.disableClickPropagation(container);

    container.onclick = () => {
      const mapContainer = map.getContainer();
      const boundaryData = mapContainer.dataset.boundary;
      
      if (boundaryData) {
        try {
          const boundary = JSON.parse(boundaryData);
          const geoJsonLayer = L.geoJSON(boundary);
          const bounds = geoJsonLayer.getBounds();
          if (bounds.isValid()) {
            map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
            return;
          }
        } catch (error) {
          console.error('Error fitting to boundary:', error);
        }
      }
      
      // Fallback to world view if no boundary
      map.setView([20, 0], 2);
    };

    return container;
  }
});

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
  const [manualLat, setManualLat] = useState('');
  const [manualLon, setManualLon] = useState('');
  const wizardContentRef = useRef(null);

  useEffect(() => {
    if (wizardContentRef.current) {
      wizardContentRef.current.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
    }
  }, [step]);

  // Parse city name parts properly handling 4+ parts
  const parseCityName = (displayName) => {
    const parts = displayName.split(',').map(part => part.trim());
    if (parts.length >= 4) {
      return {
        city: parts[0].trim(),
        province: parts[parts.length - 2].trim(),
        country: parts[parts.length - 1].trim()
      };
    } else if (parts.length === 3) {
      return {
        city: parts[0].trim(),
        province: parts[1].trim(),
        country: parts[2].trim()
      };
    } else if (parts.length === 2) {
      return {
        city: parts[0].trim(),
        province: '',
        country: parts[1].trim()
      };
    } else {
      return {
        city: (parts[0] || '').trim(),
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
          const layers = await getAvailableLayersForCity(editingCity.name);
          const hasFeatures = Object.keys(layers).length > 0;
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
  
    // Always fetch and set boundary from OSM when selecting a city
    // This replaces any previously drawn/uploaded boundaries
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
  
    // Set the new boundary (or null if not available)
    setBoundary(boundaryData);
    
    // Clear any drawn layers
    if (drawRef.current) {
      drawRef.current.clearLayers();
    }
  };

  const handleCenterMap = () => {
    if (!manualLat || !manualLon) {
      alert('Please enter both latitude and longitude');
      return;
    }
    
    const lat = parseFloat(manualLat);
    const lon = parseFloat(manualLon);
    
    if (isNaN(lat) || isNaN(lon)) {
      alert('Please enter valid numeric coordinates');
      return;
    }
    
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      alert('Coordinates out of range. Latitude: -90 to 90, Longitude: -180 to 180');
      return;
    }
    
    if (mapRef.current) {
      if (boundary) {
        // If boundary exists, fit to boundary bounds
        try {
          const geoJsonLayer = L.geoJSON(boundary);
          const bounds = geoJsonLayer.getBounds();
          if (bounds.isValid()) {
            mapRef.current.fitBounds(bounds, { 
              padding: [50, 50],
              maxZoom: 15
            });
          } else {
            // Fallback to center if bounds invalid
            mapRef.current.setView([lat, lon], 12);
          }
        } catch (error) {
          console.error('Error fitting to boundary:', error);
          mapRef.current.setView([lat, lon], 12);
        }
      } else {
        // No boundary, just center at coordinates
        mapRef.current.setView([lat, lon], 12);
      }
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
      try {
        const mergedGeometry = mergeGeometries([boundary, newGeometry]);        
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
      setBoundary(null);
      setUploadError('');
    } else {
      try {
        const mergedGeometry = mergeGeometries(remainingLayers);        
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
        if (bounds.isValid()) {
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
        try {
          const zip = await JSZip.loadAsync(zipFile);
          
          // Extract shapefile components from ZIP
          let shpBuffer = null;
          let dbfBuffer = null;
          let prjWkt = null;
          
          for (const [filename, zipEntry] of Object.entries(zip.files)) {
            if (zipEntry.dir) continue;
            
            const lowerName = filename.toLowerCase();
            
            if (lowerName.endsWith('.shp')) {
              shpBuffer = await zipEntry.async('arraybuffer');
            } else if (lowerName.endsWith('.dbf')) {
              dbfBuffer = await zipEntry.async('arraybuffer');
            } else if (lowerName.endsWith('.prj')) {
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

  const stripZCoordinates = (geometry) => {
    if (!geometry) return geometry;
    
    const strip = (coords) => {
      if (typeof coords[0] === 'number') {
        return [coords[0], coords[1]];
      }
      return coords.map(strip);
    };
    
    return {
      ...geometry,
      coordinates: strip(geometry.coordinates)
    };
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
          mergedGeometry = stripZCoordinates(mergeGeometries(geometries));
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
      
      // Reproject all geometries
      try {
        geometries = geometries.map(geom => 
          reprojectGeometry(geom, prjWkt, null)
        );
      } catch (reprojError) {
        console.error('Reprojection error:', reprojError);
        setUploadError(`Error reprojecting coordinates: ${reprojError.message}`);
        setIsProcessing(false);
        return;
      }
  
      // Merge all geometries into single MultiPolygon
      let mergedGeometry;
      try {
        mergedGeometry = stripZCoordinates(mergeGeometries(geometries));
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

  useEffect(() => {
    if (step === 3 && boundary) {
      const center = calculateBoundaryCenter(boundary);
      if (center) {
        setManualLat(center.lat);
        setManualLon(center.lon);
      }
    } else if (step === 3 && selectedCity && !boundary) {
      // If no boundary but city is selected, use city coordinates
      setManualLat(selectedCity.lat);
      setManualLon(selectedCity.lon);
    }
  }, [step, boundary, selectedCity]);

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
    if (!cityName.trim() || !country.trim() || !boundary) {
      alert('Please complete all required fields: City name, Country, and Boundary');
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
      const fullName = [cityName.trim(), province.trim(), country.trim()].filter(Boolean).join(', ');
      const normalizedOldName = editingCity ? editingCity.name.split(',').map(p => p.trim()).join(', ') : '';
      const normalizedNewName = fullName.split(',').map(p => p.trim()).join(', ');
      const isRename = editingCity && normalizedOldName !== normalizedNewName;

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
      const center = calculateBoundaryCenter(boundary);
      if (!center) {
        alert('Could not calculate coordinates from boundary');
        setIsProcessing(false);
        return;
      }
      const finalLon = parseFloat(center.lon);
      const finalLat = parseFloat(center.lat);
  
      const cityData = {
        name: fullName,
        longitude: finalLon,
        latitude: finalLat,
        boundary: JSON.stringify(boundary),
        population: populationValue,
        size: sizeValue,
        sdg_region: sdgRegion
      };

      if (editingCity) {
        const oldParsed = parseCityName(editingCity.name);
        
        if (isRename) {
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
  
  const nextStep = async () => {
    // Fetch Wikipedia data when moving to step 2
    if (step === 1) {
      // Skip Wikipedia fetch if editing city and data already exists
      if (editingCity && (wikiData.population || wikiData.size)) {
        setStep(step + 1);
        return;
      }
      
      const searchQuery = [cityName, province, country].filter(Boolean).join(', ');
      setWikiLoading(true);
      
      try {
        const wikiResult = await fetchWikipediaData(searchQuery);
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
    }
    
    setStep(step + 1);
  };

  const prevStep = () => setStep(step - 1);

  const mapCenter = selectedCity ? [parseFloat(selectedCity.lat), parseFloat(selectedCity.lon)] : [20, 0];

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

      <div className="wizard-content" ref={wizardContentRef}>
        {step === 1 && (
          <div className="step-content">
            <h3>Search for a City</h3>
            <div className="form-group">
              <input
                type="text"
                placeholder="City name *"
                value={cityName}
                onChange={(e) => {
                  const value = e.target.value;
                  const cursorPosition = e.target.selectionStart;
                  const prevValue = cityName;
                  
                  // Check if this is a deletion or manual edit
                  if (value.length < prevValue.length) {
                    // User is deleting, allow it
                    setCityName(value);
                    return;
                  }
                  
                  // Check if user manually changed capitalization (by selecting and retyping)
                  if (cursorPosition > 1 && value.length === prevValue.length) {
                    // This is a replacement, not an addition - allow manual edit
                    setCityName(value);
                    return;
                  }
                  
                  // Auto-capitalize first letter or letter after space
                  if (cursorPosition === 1 || (cursorPosition > 1 && value[cursorPosition - 2] === ' ')) {
                    const char = value[cursorPosition - 1];
                    if (char && char === char.toLowerCase() && char !== char.toUpperCase()) {
                      const capitalized = value.slice(0, cursorPosition - 1) + 
                                        char.toUpperCase() + 
                                        value.slice(cursorPosition);
                      setCityName(capitalized);
                      setTimeout(() => {
                        e.target.setSelectionRange(cursorPosition, cursorPosition);
                      }, 0);
                      return;
                    }
                  }
                  
                  setCityName(value);
                }}
                className="form-input"
              />
            </div>
            <div className="form-group">
              <input
                type="text"
                placeholder="Province/State"
                value={province}
                onChange={(e) => {
                  const value = e.target.value;
                  const cursorPosition = e.target.selectionStart;
                  const prevValue = province;
                  
                  // Check if this is a deletion or manual edit
                  if (value.length < prevValue.length) {
                    // User is deleting, allow it
                    setProvince(value);
                    return;
                  }
                  
                  // Check if user manually changed capitalization (by selecting and retyping)
                  if (cursorPosition > 1 && value.length === prevValue.length) {
                    // This is a replacement, not an addition - allow manual edit
                    setProvince(value);
                    return;
                  }
                  
                  // Auto-capitalize first letter or letter after space
                  if (cursorPosition === 1 || (cursorPosition > 1 && value[cursorPosition - 2] === ' ')) {
                    const char = value[cursorPosition - 1];
                    if (char && char === char.toLowerCase() && char !== char.toUpperCase()) {
                      const capitalized = value.slice(0, cursorPosition - 1) + 
                                        char.toUpperCase() + 
                                        value.slice(cursorPosition);
                      setProvince(capitalized);
                      setTimeout(() => {
                        e.target.setSelectionRange(cursorPosition, cursorPosition);
                      }, 0);
                      return;
                    }
                  }
                  
                  setProvince(value);
                }}
                className="form-input"
              />
            </div>
            <div className="form-group">
              <input
                type="text"
                placeholder="Country *"
                value={country}
                onChange={(e) => {
                  const value = e.target.value;
                  const cursorPosition = e.target.selectionStart;
                  const prevValue = country;
                  
                  // Check if this is a deletion or manual edit
                  if (value.length < prevValue.length) {
                    // User is deleting, allow it
                    setCountry(value);
                    return;
                  }
                  
                  // Check if user manually changed capitalization (by selecting and retyping)
                  if (cursorPosition > 1 && value.length === prevValue.length) {
                    // This is a replacement, not an addition - allow manual edit
                    setCountry(value);
                    return;
                  }
                  
                  // Auto-capitalize first letter or letter after space
                  if (cursorPosition === 1 || (cursorPosition > 1 && value[cursorPosition - 2] === ' ')) {
                    const char = value[cursorPosition - 1];
                    if (char && char === char.toLowerCase() && char !== char.toUpperCase()) {
                      const capitalized = value.slice(0, cursorPosition - 1) + 
                                        char.toUpperCase() + 
                                        value.slice(cursorPosition);
                      setCountry(capitalized);
                      setTimeout(() => {
                        e.target.setSelectionRange(cursorPosition, cursorPosition);
                      }, 0);
                      return;
                    }
                  }
                  
                  setCountry(value);
                }}
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
              <div className="suggestions" key={selectedCity?.place_id || 'no-selection'}>
                <div className="suggestions-header">
                  <h4>Select a city:</h4>
                  <a
                    href={`https://www.openstreetmap.org/search?query=${encodeURIComponent(
                      [cityName, province, country].filter(Boolean).join(', ')
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="osm-link"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <i className="fas fa-map-marked-alt"></i>
                    View on OpenStreetMap
                    <i className="fas fa-external-link-alt"></i>
                  </a>
                </div>
                {osmSuggestions.map((city) => {
                  let geometryType = 'point';
                  let geometryIcon = 'fa-map-pin';
                  let geometryColor = '#94a3b8';
                  
                  if (city.geojson) {
                    if (city.geojson.type === 'Polygon') {
                      geometryType = 'polygon';
                      geometryIcon = 'fa-draw-polygon';
                      geometryColor = '#10b981';
                    } else if (city.geojson.type === 'MultiPolygon') {
                      geometryType = 'multipolygon';
                      geometryIcon = 'fa-layer-group';
                      geometryColor = '#0891b2';
                    }
                  }
                  
                  return (
                    <motion.div
                      key={city.place_id}
                      className={`suggestion ${selectedCity?.place_id === city.place_id ? 'selected' : ''}`}
                      onClick={() => handleSelectCity(city)}
                      whileHover={{ backgroundColor: '#f0f9ff' }}
                    >
                      <div className="suggestion-content">
                        <span className="suggestion-name">{city.display_name}</span>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          {city.type && (
                            <span 
                              className="type-badge"
                              title={`Place type: ${city.type}`}
                            >
                              {city.type}
                            </span>
                          )}
                          <span 
                            className="geometry-badge"
                            style={{ color: geometryColor, borderColor: geometryColor }}
                            title={`Geometry type: ${geometryType}`}
                          >
                            <i className={`fas ${geometryIcon}`}></i>
                            {geometryType}
                          </span>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        )}
  
        {step === 2 && (
          <div className="step-content">
            <h3>City Details</h3>
            <div className="form-group">
              <label>Population</label>
              <input
                type="text"
                placeholder="Population"
                value={wikiData.population || ''}
                onChange={(e) => setWikiData({ ...wikiData, population: e.target.value })}
                onKeyDown={(e) => {
                  // Allow: backspace, delete, tab, escape, enter, arrows
                  if (['Backspace', 'Delete', 'Tab', 'Escape', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
                    return;
                  }
                  // Allow: Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+X (and Cmd on Mac)
                  if ((e.ctrlKey || e.metaKey) && ['a', 'c', 'v', 'x', 'A', 'C', 'V', 'X'].includes(e.key)) {
                    return;
                  }
                  // Ensure that it is a number and stop the keypress if not
                  if (!/^[0-9]$/.test(e.key)) {
                    e.preventDefault();
                  }
                }}
                onPaste={(e) => {
                  e.preventDefault();
                  const pastedText = e.clipboardData.getData('text');
                  const numbersOnly = pastedText.replace(/[^0-9]/g, '');
                  setWikiData({ ...wikiData, population: numbersOnly });
                }}
                className="form-input"
              />
            </div>
            <div className="form-group">
              <label>Size (km²)</label>
              <input
                type="text"
                placeholder="Area in km²"
                value={wikiData.size || ''}
                onChange={(e) => setWikiData({ ...wikiData, size: e.target.value })}
                onKeyDown={(e) => {
                  // Allow: backspace, delete, tab, escape, enter, arrows
                  if (['Backspace', 'Delete', 'Tab', 'Escape', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
                    return;
                  }
                  // Allow: Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+X (and Cmd on Mac)
                  if ((e.ctrlKey || e.metaKey) && ['a', 'c', 'v', 'x', 'A', 'C', 'V', 'X'].includes(e.key)) {
                    return;
                  }
                  // Allow decimal point (only one)
                  if (e.key === '.' && !e.target.value.includes('.')) {
                    return;
                  }
                  // Ensure that it is a number and stop the keypress if not
                  if (!/^[0-9]$/.test(e.key)) {
                    e.preventDefault();
                  }
                }}
                onPaste={(e) => {
                  e.preventDefault();
                  const pastedText = e.clipboardData.getData('text');
                  // Keep numbers and one decimal point
                  let cleaned = pastedText.replace(/[^0-9.]/g, '');
                  // Ensure only one decimal point
                  const parts = cleaned.split('.');
                  if (parts.length > 2) {
                    cleaned = parts[0] + '.' + parts.slice(1).join('');
                  }
                  setWikiData({ ...wikiData, size: cleaned });
                }}
                className="form-input"
              />
            </div>

            {wikiLoading && (
              <div className="loading-indicator">
                <i className="fas fa-spinner fa-spin"></i>
                Fetching from Wikipedia...
              </div>
            )}
            
            {wikipediaUrl && (
              <div style={{ 
                marginTop: '20px', 
                paddingTop: '15px', 
                borderTop: '1px solid #e5e7eb',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
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
                
                <button
                  onClick={async () => {
                    const searchQuery = [cityName, province, country].filter(Boolean).join(', ');
                    setWikiLoading(true);
                    try {
                      const wikiResult = await fetchWikipediaData(searchQuery);
                      setWikiData({
                        population: wikiResult.population,
                        size: wikiResult.size
                      });
                      setWikipediaUrl(wikiResult.url || null);
                    } catch (error) {
                      console.error('Error fetching Wikipedia data:', error);
                    } finally {
                      setWikiLoading(false);
                    }
                  }}
                  disabled={wikiLoading}
                  style={{
                    background: wikiLoading ? '#e2e8f0' : 'linear-gradient(135deg, #0891b2 0%, #06b6d4 100%)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '8px 16px',
                    cursor: wikiLoading ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '13px',
                    fontWeight: '600',
                    transition: 'all 0.2s'
                  }}
                  onMouseOver={(e) => {
                    if (!wikiLoading) {
                      e.currentTarget.style.background = 'linear-gradient(135deg, #0e7490 0%, #0891b2 100%)';
                      e.currentTarget.style.transform = 'translateY(-1px)';
                    }
                  }}
                  onMouseOut={(e) => {
                    if (!wikiLoading) {
                      e.currentTarget.style.background = 'linear-gradient(135deg, #0891b2 0%, #06b6d4 100%)';
                      e.currentTarget.style.transform = 'translateY(0)';
                    }
                  }}
                >
                  <i className={`fas ${wikiLoading ? 'fa-spinner fa-spin' : 'fa-sync-alt'}`}></i>
                  {wikiLoading ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="step-content">
            <h3>Define City Boundary</h3>
            
            {/* Manual coordinate input for centering map */}
            <div className="coordinate-input-section">
              <div className="coordinate-inputs">
                <div className="form-group coordinate-field">
                  <label>Latitude</label>
                  <input
                    type="number"
                    step="0.000001"
                    placeholder="e.g., 43.7177"
                    value={manualLat}
                    onChange={(e) => setManualLat(e.target.value)}
                    className="form-input"
                  />
                </div>
                <div className="form-group coordinate-field">
                  <label>Longitude</label>
                  <input
                    type="number"
                    step="0.000001"
                    placeholder="e.g., -79.3763"
                    value={manualLon}
                    onChange={(e) => setManualLon(e.target.value)}
                    className="form-input"
                  />
                </div>
                <motion.button
                  className="center-map-btn"
                  onClick={handleCenterMap}
                  disabled={!manualLat || !manualLon}
                  whileHover={{ scale: (!manualLat || !manualLon) ? 1 : 1.02 }}
                  whileTap={{ scale: (!manualLat || !manualLon) ? 1 : 0.98 }}
                >
                  <i className="fas fa-crosshairs"></i>
                  Center Map
                </motion.button>
              </div>
            </div>
            
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
              <div style={{ fontSize: '12px', color: '#0891b2', marginTop: '8px' }}>
                <i className="fas fa-info-circle"></i> Upload GeoJSON (.geojson, .json), Shapefile (.shp + optional .dbf, .shx, .prj), or ZIP file containing all shapefile components. 
                For separate shapefiles, select all files at once. If no .prj file is provided, assumes WGS 1984 UTM Zone 19S (EPSG:32719).
              </div>
            </div>
            <div className="map-container-wizard">
              <MapContainer
                ref={mapRef}
                center={mapCenter}
                zoom={selectedCity ? 12 : 2}
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

            {/* OpenStreetMap boundary link */}
            {selectedCity && selectedCity.osm_type && selectedCity.osm_id && (
              <div style={{ 
                marginTop: '20px', 
                paddingTop: '15px', 
                borderTop: '1px solid #e5e7eb' 
              }}>
                <a 
                  href={`https://www.openstreetmap.org/${selectedCity.osm_type}/${selectedCity.osm_id}`}
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
                  <i className="fas fa-map-marked-alt"></i>
                  View boundary on OpenStreetMap
                  <i className="fas fa-external-link-alt" style={{ fontSize: '12px' }}></i>
                </a>
              </div>
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
          {step > 1 ? (
            <motion.button
              className="btn btn-secondary"
              onClick={prevStep}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <i className="fas fa-arrow-left"></i>
              Previous
            </motion.button>
          ) : (
            <div></div>
          )}
          {step < 3 ? (
            <motion.button
              className="btn btn-primary"
              onClick={nextStep}
              disabled={step === 1 && (!cityName.trim() || !country.trim())}
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
                  {editingCity ? 'Updating...' : 'Saving...'}
                </>
              ) : (
                <>
                  <i className="fas fa-check"></i>
                  {editingCity ? 'Update' : 'Save'}
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
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { MapContainer, TileLayer, FeatureGroup, useMap } from 'react-leaflet';
import { EditControl } from 'react-leaflet-draw';
import L from 'leaflet';
import * as shp from 'shapefile';
import proj4 from 'proj4';
import { searchOSM, fetchWikipediaData, fetchOSMBoundary } from '../utils/osm';
import { saveCityData, processCityFeatures, checkCityExists, moveCityData, deleteCityData } from '../utils/s3';
import { getSDGRegion } from '../utils/regions';
import 'leaflet-draw/dist/leaflet.draw.css';

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

const AddCityWizard = ({ editingCity, onComplete, onCancel }) => {
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
  const [shouldProcessFeatures, setShouldProcessFeatures] = useState(true);
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
    }
  }, [editingCity]);

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

    // Try to get boundary from OSM
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

    setBoundary(boundaryData);

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
    if (drawRef.current) {
      drawRef.current.clearLayers();
      drawRef.current.addLayer(layer);
    }
    setBoundary(layer.toGeoJSON().geometry);
  };

  const handleDrawEdited = (e) => {
    e.layers.eachLayer((layer) => {
      setBoundary(layer.toGeoJSON().geometry);
    });
  };

  const handleBoundaryLoad = useCallback((map) => {
    if (boundary && drawRef.current && map) {
      console.log('Loading boundary on map:', boundary);
      console.log('Boundary coordinates sample:', boundary.coordinates);
      drawRef.current.clearLayers();
      
      try {
        const feature = {
          type: 'Feature',
          geometry: boundary,
          properties: {}
        };
        
        const geoJsonLayer = L.geoJSON(feature, {
          style: {
            color: '#0891b2',
            weight: 2,
            fillOpacity: 0.2,
            interactive: false
          }
        });
        
        drawRef.current.addLayer(geoJsonLayer);
        
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

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (!files || files.length === 0) return;

    setUploadError('');
    setIsProcessing(true);

    try {
      const geojsonFile = files.find(f => {
        const name = f.name.toLowerCase();
        return name.endsWith('.geojson') || name.endsWith('.json');
      });
      
      const shpFile = files.find(f => f.name.toLowerCase().endsWith('.shp'));

      if (geojsonFile) {
        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const geojson = JSON.parse(event.target.result);
            let geometry;
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

            if (geojson.type === 'FeatureCollection') {
              if (!geojson.features || geojson.features.length === 0) {
                setUploadError('FeatureCollection is empty');
                setIsProcessing(false);
                return;
              }
              geometry = geojson.features[0].geometry;
            } 
            else if (geojson.type === 'Feature') {
              geometry = geojson.geometry;
            } 
            else if (['Polygon', 'MultiPolygon'].includes(geojson.type)) {
              geometry = geojson;
            } else {
              setUploadError('Please upload a valid Polygon or MultiPolygon GeoJSON');
              setIsProcessing(false);
              return;
            }

            if (!['Polygon', 'MultiPolygon'].includes(geometry.type)) {
              setUploadError('Please upload a valid Polygon or MultiPolygon GeoJSON');
              setIsProcessing(false);
              return;
            }

            if (!geometry.coordinates || geometry.coordinates.length === 0) {
              setUploadError('GeoJSON geometry has invalid or empty coordinates');
              setIsProcessing(false);
              return;
            }

            console.log('Successfully loaded GeoJSON boundary:', geometry);
            
            if (crsInfo && crsInfo !== 'EPSG:4326') {
              try {
                geometry = reprojectGeometry(geometry, null, crsInfo);
                console.log('Reprojected GeoJSON boundary to WGS84:', geometry);
              } catch (reprojError) {
                console.error('Reprojection error:', reprojError);
                setUploadError(`Error reprojecting coordinates: ${reprojError.message}`);
                setIsProcessing(false);
                return;
              }
            }
            
            setBoundary(geometry);
            
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
      }
      else if (shpFile) {
        try {
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

          const geojson = await shp.read(shpBuffer, dbfBuffer);
          
          if (!geojson || !geojson.features || geojson.features.length === 0) {
            setUploadError('Shapefile is empty or invalid');
            setIsProcessing(false);
            return;
          }

          let geometry = geojson.features[0].geometry;
          
          if (!['Polygon', 'MultiPolygon'].includes(geometry.type)) {
            setUploadError('Shapefile must contain Polygon or MultiPolygon geometry');
            setIsProcessing(false);
            return;
          }

          if (!geometry.coordinates || geometry.coordinates.length === 0) {
            setUploadError('Shapefile geometry has invalid or empty coordinates');
            setIsProcessing(false);
            return;
          }

          console.log('Original Shapefile boundary:', geometry);
          
          try {
            geometry = reprojectGeometry(geometry, prjWkt, null);
            console.log('Reprojected boundary to WGS84:', geometry);
          } catch (reprojError) {
            console.error('Reprojection error:', reprojError);
            setUploadError(`Error reprojecting coordinates: ${reprojError.message}`);
            setIsProcessing(false);
            return;
          }

          setBoundary(geometry);
          
          if (drawRef.current) {
            drawRef.current.clearLayers();
          }
          
          setIsProcessing(false);
        } catch (error) {
          console.error('Error parsing Shapefile:', error);
          setUploadError(`Error parsing Shapefile: ${error.message}. Please ensure the file is valid.`);
          setIsProcessing(false);
        }
      }
      else {
        const fileExtensions = files.map(f => f.name.toLowerCase().split('.').pop());
        
        if (fileExtensions.some(ext => ['shx', 'dbf', 'prj', 'cpg', 'qmd'].includes(ext))) {
          setUploadError(
            'You selected Shapefile component files. Please also select the .shp file ' +
            '(you can select multiple files at once).'
          );
        } else {
          const uploadedExt = fileExtensions[0];
          setUploadError(
            `Unsupported file format: .${uploadedExt}. ` +
            'Please upload a GeoJSON (.geojson, .json) or Shapefile (.shp with optional .dbf, .shx files).'
          );
        }
        setIsProcessing(false);
      }
    } catch (error) {
      console.error('Error processing file:', error);
      setUploadError(`Error processing file: ${error.message}`);
      setIsProcessing(false);
    }

    e.target.value = '';
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
  
    setIsProcessing(true);
    try {
      const fullName = [cityName, province, country].filter(Boolean).join(', ');
      
      const isRename = editingCity && editingCity.name !== fullName;
      const boundaryActuallyChanged = hasBoundaryChanged();
      
      if (!editingCity || isRename) {
        const existingCity = await checkCityExists(country, province, cityName);
        if (existingCity) {
          alert(`A city with this name already exists: ${fullName}\n\nPlease use a different name or edit the existing city.`);
          setIsProcessing(false);
          return;
        }
      }
      
      const sdgRegion = getSDGRegion(country);
  
      const cityData = {
        name: fullName,
        longitude: parseFloat(selectedCity.lon),
        latitude: parseFloat(selectedCity.lat),
        boundary: JSON.stringify(boundary),
        population: wikiData.population ? parseInt(wikiData.population) : null,
        size: wikiData.size ? parseFloat(wikiData.size) : null,
        sdg_region: sdgRegion
      };
  
      await saveCityData(cityData, country, province, cityName);
  
      if (editingCity) {
        const oldParsed = parseCityName(editingCity.name);
        
        if (isRename) {
          console.log('City renamed, moving existing data...');
          await moveCityData(
            oldParsed.country,
            oldParsed.province,
            oldParsed.city,
            country,
            province,
            cityName
          );
          
          await deleteCityData(editingCity.name);
        }
        
        if (boundaryActuallyChanged && shouldProcessFeatures) {
          await onComplete(cityData, (progressHandler) => {
            setTimeout(async () => {
              try {
                await processCityFeatures(
                  cityData, 
                  country, 
                  province, 
                  cityName,
                  progressHandler
                );
                console.log('Background processing completed for', fullName);
              } catch (error) {
                console.error('Background processing error:', error);
              }
            }, 1000);
          });
        } else {
          await onComplete(cityData, null);
        }
      } else {
        if (shouldProcessFeatures) {
          await onComplete(cityData, (progressHandler) => {
            setTimeout(async () => {
              try {
                await processCityFeatures(
                  cityData, 
                  country, 
                  province, 
                  cityName,
                  progressHandler
                );
                console.log('Background processing completed for', fullName);
              } catch (error) {
                console.error('Background processing error:', error);
              }
            }, 1000);
          });
        } else {
          await onComplete(cityData, null);
        }
      }
  
    } catch (error) {
      console.error('Error saving city:', error);
      alert('Error saving city. Please try again.');
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
                  accept=".geojson,.json,.shp,.shx,.dbf,.prj"
                  onChange={handleFileUpload}
                  multiple
                  style={{ display: 'none' }}
                />
              </label>
              <span className="or-text">or draw on map</span>
            </div>
            <div className="boundary-controls">
              <div style={{ fontSize: '12px', color: '#666', marginTop: '8px' }}>
                  <i className="fas fa-info-circle"></i> Upload GeoJSON (.geojson, .json) or Shapefile (.shp + optional .dbf, .shx, .prj). 
                  For shapefiles, select all files at once. If no .prj file is provided, assumes WGS 1984 UTM Zone 19S (EPSG:32719).
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
                disabled={editingCity && !hasBoundaryChanged()}
              />
              <label 
                htmlFor="process-features" 
                style={{ 
                  fontSize: '14px', 
                  color: '#374151',
                  cursor: editingCity && !hasBoundaryChanged() ? 'not-allowed' : 'pointer',
                  opacity: editingCity && !hasBoundaryChanged() ? 0.6 : 1,
                  flex: 1
                }}
              >
                {editingCity && !hasBoundaryChanged() ? (
                  <>
                    <strong>Process OpenStreetMap features</strong>
                    <br />
                    <span style={{ fontSize: '12px', color: '#6b7280' }}>
                      Boundary unchanged - existing feature data will be preserved
                    </span>
                  </>
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
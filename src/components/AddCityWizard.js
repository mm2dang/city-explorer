import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { MapContainer, TileLayer, FeatureGroup, useMap } from 'react-leaflet';
import { EditControl } from 'react-leaflet-draw';
import L from 'leaflet';
import * as shp from 'shapefile'
import { searchOSM, fetchWikipediaData, fetchOSMBoundary } from '../utils/osm';
import { saveCityData, processCityFeatures, checkCityExists } from '../utils/s3';
import { getSDGRegion } from '../utils/regions';
import 'leaflet-draw/dist/leaflet.draw.css';

const MapController = ({ center, boundary, onBoundaryLoad }) => {
  const map = useMap();

  useEffect(() => {
    if (boundary) {
      try {
        const geoJsonLayer = L.geoJSON(boundary);
        const bounds = geoJsonLayer.getBounds();
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [20, 20] });
        } else {
          map.setView(center || [51.505, -0.09], 12);
        }
      } catch (error) {
        console.error('Error fitting bounds:', error);
        map.setView(center || [51.505, -0.09], 12);
      }
    } else if (center && center[0] && center[1]) {
      map.setView(center, 12);
    }
  }, [center, boundary, map]);

  useEffect(() => {
    if (boundary && onBoundaryLoad) {
      onBoundaryLoad(map);
    }
  }, [boundary, onBoundaryLoad, map]);

  return null;
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
  const [boundary, setBoundary] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [wikiLoading, setWikiLoading] = useState(false);
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
        setBoundary(JSON.parse(editingCity.boundary));
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

    // Fetch Wikipedia data
    setWikiLoading(true);
    try {
      const wikiResult = await fetchWikipediaData(city.display_name);
      setWikiData({
        population: wikiResult.population,
        size: wikiResult.size
      });
    } catch (error) {
      console.error('Error fetching Wikipedia data:', error);
      setWikiData({ population: null, size: null });
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
    if (boundary && drawRef.current) {
      drawRef.current.clearLayers();
      const geoJsonLayer = L.geoJSON(boundary, {
        style: {
          color: '#0891b2',
          weight: 2,
          fillOpacity: 0.2,
          interactive: false
        }
      });
      drawRef.current.addLayer(geoJsonLayer);
      try {
        const bounds = geoJsonLayer.getBounds();
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [20, 20] });
        }
      } catch (error) {
        console.error('Error fitting bounds:', error);
      }
    }
  }, [boundary]);

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (!files || files.length === 0) return;

    setUploadError('');
    setIsProcessing(true);

    try {
      const file = files[0];
      const fileName = file.name.toLowerCase();
      const fileExt = fileName.split('.').pop();

      // Handle GeoJSON files
      if (fileExt === 'geojson' || fileExt === 'json') {
        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const geojson = JSON.parse(event.target.result);
            let geometry;

            // Handle FeatureCollection
            if (geojson.type === 'FeatureCollection') {
              if (!geojson.features || geojson.features.length === 0) {
                setUploadError('FeatureCollection is empty');
                setIsProcessing(false);
                return;
              }
              // Use the first feature's geometry
              geometry = geojson.features[0].geometry;
            } 
            // Handle Feature
            else if (geojson.type === 'Feature') {
              geometry = geojson.geometry;
            } 
            // Handle direct geometry
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
            setBoundary(geometry);
            setIsProcessing(false);
          } catch (error) {
            console.error('Error parsing GeoJSON:', error);
            setUploadError('Invalid GeoJSON file. Please check the format.');
            setIsProcessing(false);
          }
        };
        reader.readAsText(file);
      }
      // Handle Shapefile formats
      else if (fileExt === 'shp') {
        try {
          const arrayBuffer = await file.arrayBuffer();
          
          // Try to find associated .dbf file if multiple files were selected
          let dbfBuffer = null;
          const dbfFile = files.find(f => f.name.toLowerCase().endsWith('.dbf'));
          if (dbfFile) {
            dbfBuffer = await dbfFile.arrayBuffer();
          }

          // Read the shapefile
          const geojson = await shp.read(arrayBuffer, dbfBuffer);
          
          if (!geojson || !geojson.features || geojson.features.length === 0) {
            setUploadError('Shapefile is empty or invalid');
            setIsProcessing(false);
            return;
          }

          // Extract geometry from first feature
          const geometry = geojson.features[0].geometry;
          
          if (!['Polygon', 'MultiPolygon'].includes(geometry.type)) {
            setUploadError('Shapefile must contain Polygon or MultiPolygon geometry');
            setIsProcessing(false);
            return;
          }

          setBoundary(geometry);
          setIsProcessing(false);
        } catch (error) {
          console.error('Error parsing Shapefile:', error);
          setUploadError('Error parsing Shapefile. Please ensure the file is valid.');
          setIsProcessing(false);
        }
      }
      // Handle other Shapefile component files
      else if (['shx', 'dbf', 'prj', 'cpg', 'qmd'].includes(fileExt)) {
        setUploadError(
          `You've selected a .${fileExt} file. Please select the .shp file instead. `
        );
        setIsProcessing(false);
      } else {
        setUploadError(`Unsupported file format: .${fileExt}. Please upload a GeoJSON (.geojson, .json) or Shapefile (.shp).`);
        setIsProcessing(false);
      }
    } catch (error) {
      console.error('Error processing file:', error);
      setUploadError('Error processing file. Please try again.');
      setIsProcessing(false);
    }

    // Clear the input so the same file can be selected again
    e.target.value = '';
  };

  const handleSubmit = async () => {
    if (!cityName.trim() || !selectedCity || !boundary) {
      alert('Please complete all required fields');
      return;
    }
  
    setIsProcessing(true);
    try {
      const fullName = [cityName, province, country].filter(Boolean).join(', ');
      
      // Check for duplicate city
      const existingCity = await checkCityExists(country, province, cityName);
      if (existingCity && !editingCity) {
        alert(`A city with this name already exists: ${fullName}\n\nPlease use a different name or edit the existing city.`);
        setIsProcessing(false);
        return;
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
  
      // Save city data to population bucket
      await saveCityData(cityData, country, province, cityName);
  
      // Call onComplete with city data and a callback setter function
      await onComplete(cityData, (progressHandler) => {
        // Start background processing with progress updates
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
                  accept=".geojson,.json,.shp"
                  onChange={handleFileUpload}
                  style={{ display: 'none' }}
                />
              </label>
              <span className="or-text">or draw on map</span>
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
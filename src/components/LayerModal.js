import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import 'leaflet-draw';
import shp from 'shpjs';
import '../styles/LayerModal.css';

const LayerModal = ({ 
  isOpen, 
  onClose, 
  editingLayer, 
  domain, 
  domainColor,
  existingLayers,
  onSave,
  cityBoundary 
}) => {
  const [step, setStep] = useState(1);
  const [layerName, setLayerName] = useState('');
  const [layerIcon, setLayerIcon] = useState('fas fa-map-marker-alt');
  const [dataSource, setDataSource] = useState('upload');
  const [uploadedFile, setUploadedFile] = useState(null);
  const [uploadedFileCount, setUploadedFileCount] = useState(0);
  const [features, setFeatures] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const drawnItemsRef = useRef(null);
  const fileInputRef = useRef(null);
  const reviewMapRef = useRef(null);
  const reviewMapInstanceRef = useRef(null);
  const reviewDrawnItemsRef = useRef(null);

  const availableIcons = [
    'fas fa-map-marker-alt', 'fas fa-home', 'fas fa-building', 'fas fa-store',
    'fas fa-hospital', 'fas fa-school', 'fas fa-tree', 'fas fa-road',
    'fas fa-parking', 'fas fa-bus', 'fas fa-train', 'fas fa-plane',
    'fas fa-ship', 'fas fa-bicycle', 'fas fa-walking', 'fas fa-car',
    'fas fa-landmark', 'fas fa-university', 'fas fa-fire-extinguisher',
    'fas fa-shield-alt', 'fas fa-utensils', 'fas fa-coffee', 'fas fa-wine-glass-alt',
    'fas fa-shopping-cart', 'fas fa-plus', 'fas fa-heart', 'fas fa-star'
  ];

  useEffect(() => {
    if (editingLayer) {
      setLayerName(editingLayer.name);
      setLayerIcon(editingLayer.icon);
      setFeatures(editingLayer.features || []);
      setStep(3);
      setDataSource('draw');
    } else {
      // Reset form when opening for new layer
      setStep(1);
      setLayerName('');
      setLayerIcon('fas fa-map-marker-alt');
      setDataSource('upload');
      setUploadedFile(null);
      setUploadedFileCount(0);
      setFeatures([]);
    }
  }, [editingLayer, isOpen]);

  // Initialize map for drawing
  useEffect(() => {
    if (step === 3 && dataSource === 'draw' && mapRef.current && !mapInstanceRef.current) {
      const map = L.map(mapRef.current).setView([43.4643, -80.5204], 12);
      
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(map);

      if (cityBoundary) {
        try {
          const boundary = typeof cityBoundary === 'string' ? JSON.parse(cityBoundary) : cityBoundary;
          const boundaryLayer = L.geoJSON(boundary, {
            style: {
              color: '#0891b2',
              weight: 2,
              opacity: 0.6,
              fillOpacity: 0.05
            }
          });
          boundaryLayer.addTo(map);
          map.fitBounds(boundaryLayer.getBounds(), { padding: [20, 20] });
        } catch (error) {
          console.warn('Could not display city boundary:', error);
        }
      }

      const drawnItems = new L.FeatureGroup();
      map.addLayer(drawnItems);
      drawnItemsRef.current = drawnItems;

      if (editingLayer && editingLayer.features) {
        editingLayer.features.forEach(feature => {
          try {
            if (feature.geometry.type === 'Point') {
              // Handle Point geometry with custom icon
              const [lon, lat] = feature.geometry.coordinates;
              
              if (isNaN(lon) || isNaN(lat)) {
                console.warn('Invalid coordinates for point:', lon, lat);
                return;
              }
              
              const marker = L.marker([lat, lon], {
                icon: L.divIcon({
                  className: 'custom-marker-icon',
                  html: `<div style="
                    background-color: ${domainColor}; 
                    width: 28px; 
                    height: 28px; 
                    border-radius: 50%; 
                    border: 2px solid white; 
                    box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    font-size: 12px;
                  ">
                    <i class="${layerIcon}"></i>
                  </div>`,
                  iconSize: [28, 28],
                  iconAnchor: [14, 14]
                })
              });
              
              // Add popup with feature information
              const featureName = feature.properties?.name || feature.properties?.feature_name || 'Unnamed Feature';
              marker.bindPopup(`
                <div style="font-family: Inter, sans-serif;">
                  <h4 style="margin: 0 0 8px 0; color: #1a202c; font-size: 14px;">
                    ${featureName}
                  </h4>
                  <p style="margin: 0; color: #64748b; font-size: 12px;">
                    <strong>Layer:</strong> ${layerName}<br>
                    <strong>Domain:</strong> ${domain}
                  </p>
                </div>
              `);
              
              drawnItems.addLayer(marker);
            } else {
              // Handle other geometry types (Polygon, LineString, MultiPolygon, MultiLineString, etc.)
              const layer = L.geoJSON(feature.geometry, {
                style: {
                  color: domainColor,
                  weight: 3,
                  opacity: 0.8,
                  fillColor: domainColor,
                  fillOpacity: 0.2
                }
              });
              
              // Add popup for non-point features
              const featureName = feature.properties?.name || feature.properties?.feature_name || 'Unnamed Feature';
              layer.bindPopup(`
                <div style="font-family: Inter, sans-serif;">
                  <h4 style="margin: 0 0 8px 0; color: #1a202c; font-size: 14px;">
                    ${featureName}
                  </h4>
                  <p style="margin: 0; color: #64748b; font-size: 12px;">
                    <strong>Layer:</strong> ${layerName}<br>
                    <strong>Domain:</strong> ${domain}<br>
                    <strong>Type:</strong> ${feature.geometry.type}
                  </p>
                </div>
              `);
              
              layer.eachLayer(l => drawnItems.addLayer(l));
            }
          } catch (error) {
            console.error('Error adding feature to map:', error, feature);
          }
        });
        
        // Fit map to show all features if there are any
        if (drawnItems.getLayers().length > 0) {
          map.fitBounds(drawnItems.getBounds(), { padding: [20, 20] });
        } else if (cityBoundary) {
          // If no features, keep the city boundary bounds
          try {
            const boundary = typeof cityBoundary === 'string' ? JSON.parse(cityBoundary) : cityBoundary;
            const boundaryLayer = L.geoJSON(boundary);
            map.fitBounds(boundaryLayer.getBounds(), { padding: [20, 20] });
          } catch (error) {
            console.warn('Could not fit bounds to city boundary:', error);
          }
        }
      }

      const drawControl = new L.Control.Draw({
        edit: {
          featureGroup: drawnItems,
          remove: true
        },
        draw: {
          polygon: true,
          polyline: true,
          rectangle: true,
          circle: false,
          circlemarker: false,
          marker: {
            icon: L.divIcon({
              className: 'custom-marker-icon',
              html: `<div style="
                background-color: ${domainColor}; 
                width: 28px; 
                height: 28px; 
                border-radius: 50%; 
                border: 2px solid white; 
                box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-size: 12px;
              ">
                <i class="${layerIcon}"></i>
              </div>`,
              iconSize: [28, 28],
              iconAnchor: [14, 14]
            })
          }
        }
      });
      map.addControl(drawControl);

      map.on(L.Draw.Event.CREATED, (e) => {
        const layer = e.layer;
        drawnItems.addLayer(layer);
        updateFeaturesFromMap();
      });

      map.on(L.Draw.Event.EDITED, () => {
        updateFeaturesFromMap();
      });

      map.on(L.Draw.Event.DELETED, () => {
        updateFeaturesFromMap();
      });

      mapInstanceRef.current = map;

      return () => {
        if (mapInstanceRef.current) {
          mapInstanceRef.current.remove();
          mapInstanceRef.current = null;
        }
      };
    }
  }, [step, dataSource, cityBoundary, domainColor, layerIcon, editingLayer, layerName, domain]);

  // Initialize review map
  useEffect(() => {
    if (step === 4 && reviewMapRef.current && !reviewMapInstanceRef.current && features.length > 0) {
      console.log('Initializing review map with features:', features.length);
      
      // Small delay to ensure DOM is ready
      setTimeout(() => {
        if (!reviewMapRef.current) return;
        
        const map = L.map(reviewMapRef.current).setView([43.4643, -80.5204], 12);
      
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap contributors'
        }).addTo(map);

        if (cityBoundary) {
          try {
            const boundary = typeof cityBoundary === 'string' ? JSON.parse(cityBoundary) : cityBoundary;
            const boundaryLayer = L.geoJSON(boundary, {
              style: {
                color: '#0891b2',
                weight: 2,
                opacity: 0.6,
                fillOpacity: 0.05
              }
            });
            boundaryLayer.addTo(map);
          } catch (error) {
            console.warn('Could not display city boundary:', error);
          }
        }

        const drawnItems = new L.FeatureGroup();
        map.addLayer(drawnItems);
        reviewDrawnItemsRef.current = drawnItems;

        console.log('Adding features to review map:', features.length);

        // Add uploaded features to map
        let addedFeatures = 0;
        features.forEach(feature => {
          try {
            console.log('Processing feature:', feature.geometry.type, feature.geometry.coordinates);
            
            if (feature.geometry.type === 'Point') {
              // Handle Point geometry with custom icon
              const [lon, lat] = feature.geometry.coordinates;
              
              if (isNaN(lon) || isNaN(lat)) {
                console.warn('Invalid coordinates:', lon, lat);
                return;
              }
              
              console.log('Creating marker at:', lat, lon);
              
              const marker = L.marker([lat, lon], {
                icon: L.divIcon({
                  className: 'custom-marker-icon',
                  html: `<div style="
                    background-color: ${domainColor}; 
                    width: 28px; 
                    height: 28px; 
                    border-radius: 50%; 
                    border: 2px solid white; 
                    box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    font-size: 12px;
                  ">
                    <i class="${layerIcon}"></i>
                  </div>`,
                  iconSize: [28, 28],
                  iconAnchor: [14, 14]
                })
              });
              
              // Add popup with feature information
              const featureName = feature.properties?.name || feature.properties?.feature_name || 'Unnamed Feature';
              marker.bindPopup(`
                <div style="font-family: Inter, sans-serif;">
                  <h4 style="margin: 0 0 8px 0; color: #1a202c; font-size: 14px;">
                    ${featureName}
                  </h4>
                  <p style="margin: 0; color: #64748b; font-size: 12px;">
                    <strong>Layer:</strong> ${layerName}<br>
                    <strong>Domain:</strong> ${domain}
                  </p>
                </div>
              `);
              
              drawnItems.addLayer(marker);
              addedFeatures++;
            } else {
              // Handle other geometry types (Polygon, LineString, MultiPolygon, etc.)
              console.log('Creating GeoJSON layer for:', feature.geometry.type);
              
              const geoJsonLayer = L.geoJSON(feature, {
                style: {
                  color: domainColor,
                  weight: 3,
                  opacity: 0.8,
                  fillColor: domainColor,
                  fillOpacity: 0.2
                },
                pointToLayer: (feature, latlng) => {
                  // In case there are points in MultiPoint or GeometryCollection
                  return L.marker(latlng, {
                    icon: L.divIcon({
                      className: 'custom-marker-icon',
                      html: `<div style="
                        background-color: ${domainColor}; 
                        width: 28px; 
                        height: 28px; 
                        border-radius: 50%; 
                        border: 2px solid white; 
                        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        color: white;
                        font-size: 12px;
                      ">
                        <i class="${layerIcon}"></i>
                      </div>`,
                      iconSize: [28, 28],
                      iconAnchor: [14, 14]
                    })
                  });
                }
              });
              
              // Add popup for non-point features
              const featureName = feature.properties?.name || feature.properties?.feature_name || 'Unnamed Feature';
              geoJsonLayer.bindPopup(`
                <div style="font-family: Inter, sans-serif;">
                  <h4 style="margin: 0 0 8px 0; color: #1a202c; font-size: 14px;">
                    ${featureName}
                  </h4>
                  <p style="margin: 0; color: #64748b; font-size: 12px;">
                    <strong>Layer:</strong> ${layerName}<br>
                    <strong>Domain:</strong> ${domain}<br>
                    <strong>Type:</strong> ${feature.geometry.type}
                  </p>
                </div>
              `);

              // Add the geometry to the map
              geoJsonLayer.eachLayer(l => {
                drawnItems.addLayer(l);
                console.log('Added layer to drawnItems:', l);
              });

              // Add a marker at the centroid for Polygon, MultiPolygon, LineString, and MultiLineString
              if (['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString'].includes(feature.geometry.type)) {
                let centroid;
                try {
                  if (feature.geometry.type === 'Polygon' || feature.geometry.type === 'LineString') {
                    // For single Polygon or LineString, use Leaflet's getBounds().getCenter()
                    const tempLayer = L.geoJSON(feature);
                    centroid = tempLayer.getBounds().getCenter();
                  } else if (feature.geometry.type === 'MultiPolygon' || feature.geometry.type === 'MultiLineString') {
                    // For MultiPolygon or MultiLineString, compute weighted centroid of all components
                    const tempLayer = L.geoJSON(feature);
                    centroid = tempLayer.getBounds().getCenter();
                  }

                  if (centroid && !isNaN(centroid.lat) && !isNaN(centroid.lng)) {
                    const centroidMarker = L.marker([centroid.lat, centroid.lng], {
                      icon: L.divIcon({
                        className: 'custom-marker-icon',
                        html: `<div style="
                          background-color: ${domainColor}; 
                          width: 28px; 
                          height: 28px; 
                          border-radius: 50%; 
                          border: 2px solid white; 
                          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                          display: flex;
                          align-items: center;
                          justify-content: center;
                          color: white;
                          font-size: 12px;
                        ">
                          <i class="${layerIcon}"></i>
                        </div>`,
                        iconSize: [28, 28],
                        iconAnchor: [14, 14]
                      })
                    });

                    centroidMarker.bindPopup(`
                      <div style="font-family: Inter, sans-serif;">
                        <h4 style="margin: 0 0 8px 0; color: #1a202c; font-size: 14px;">
                          ${featureName} (Centroid)
                        </h4>
                        <p style="margin: 0; color: #64748b; font-size: 12px;">
                          <strong>Layer:</strong> ${layerName}<br>
                          <strong>Domain:</strong> ${domain}<br>
                          <strong>Type:</strong> ${feature.geometry.type} Centroid
                        </p>
                      </div>
                    `);

                    drawnItems.addLayer(centroidMarker);
                    console.log('Added centroid marker at:', centroid.lat, centroid.lng);
                  } else {
                    console.warn('Invalid centroid coordinates:', centroid);
                  }
                } catch (error) {
                  console.error('Error calculating centroid for feature:', feature.geometry.type, error);
                }
              }

              addedFeatures++;
            }
          } catch (error) {
            console.error('Error adding feature to map:', error, feature);
          }
        });

        console.log('Successfully added features:', addedFeatures);

        // Fit map to show all features
        if (drawnItems.getLayers().length > 0) {
          console.log('Fitting bounds to features');
          map.fitBounds(drawnItems.getBounds(), { padding: [50, 50] });
        } else {
          console.warn('No layers added to drawnItems');
        }

        // Add draw control for editing
        const drawControl = new L.Control.Draw({
          edit: {
            featureGroup: drawnItems,
            remove: true
          },
          draw: {
            polygon: true,
            polyline: true,
            rectangle: true,
            circle: false,
            circlemarker: false,
            marker: {
              icon: L.divIcon({
                className: 'custom-marker-icon',
                html: `<div style="
                  background-color: ${domainColor}; 
                  width: 28px; 
                  height: 28px; 
                  border-radius: 50%; 
                  border: 2px solid white; 
                  box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  color: white;
                  font-size: 12px;
                ">
                  <i class="${layerIcon}"></i>
                </div>`,
                iconSize: [28, 28],
                iconAnchor: [14, 14]
              })
            }
          }
        });
        map.addControl(drawControl);

        map.on(L.Draw.Event.CREATED, (e) => {
          const layer = e.layer;
          drawnItems.addLayer(layer);
          updateReviewFeaturesFromMap();
        });

        map.on(L.Draw.Event.EDITED, () => {
          updateReviewFeaturesFromMap();
        });

        map.on(L.Draw.Event.DELETED, () => {
          updateReviewFeaturesFromMap();
        });

        reviewMapInstanceRef.current = map;
      }, 100); // Small delay to ensure DOM is ready

      return () => {
        if (reviewMapInstanceRef.current) {
          reviewMapInstanceRef.current.remove();
          reviewMapInstanceRef.current = null;
        }
      };
    }
  }, [step, features, cityBoundary, domainColor, layerIcon, layerName, domain]);

  const updateReviewFeaturesFromMap = useCallback(() => {
    if (!reviewDrawnItemsRef.current) return;
    
    const newFeatures = [];
    reviewDrawnItemsRef.current.eachLayer(layer => {
      const geojson = layer.toGeoJSON();
      newFeatures.push({
        type: 'Feature',
        geometry: geojson.geometry,
        properties: {
          name: layerName,
          layer_name: layerName,
          domain_name: domain
        }
      });
    });
    setFeatures(newFeatures);
  }, [layerName, domain]);

  const updateFeaturesFromMap = useCallback(() => {
    if (!drawnItemsRef.current) return;
    
    const newFeatures = [];
    drawnItemsRef.current.eachLayer(layer => {
      const geojson = layer.toGeoJSON();
      newFeatures.push({
        type: 'Feature',
        geometry: geojson.geometry,
        properties: {
          name: layerName,
          layer_name: layerName,
          domain_name: domain
        }
      });
    });
    setFeatures(newFeatures);
  }, [layerName, domain]);

  const handleFileUpload = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsProcessing(true);
    setUploadedFile(files[0]);
    setUploadedFileCount(files.length);

    try {
      // Check if it's a single file or multiple files
      if (files.length === 1) {
        const file = files[0];
        const fileExt = file.name.toLowerCase().split('.').pop();
        
        if (fileExt === 'geojson' || fileExt === 'json') {
          const text = await file.text();
          const geojson = JSON.parse(text);
          
          const parsedFeatures = geojson.type === 'FeatureCollection' 
            ? geojson.features 
            : [geojson];
          
          setFeatures(parsedFeatures.map(f => ({
            ...f,
            properties: {
              ...f.properties,
              layer_name: layerName,
              domain_name: domain
            }
          })));
          setStep(4);
        } else if (fileExt === 'zip') {
          const arrayBuffer = await file.arrayBuffer();
          
          // shpjs library handles .zip files containing shapefiles
          const geojson = await shp(arrayBuffer);
          
          // Handle both single shapefile and multiple shapefiles from zip
          let allFeatures = [];
          if (Array.isArray(geojson)) {
            geojson.forEach(layer => {
              const features = layer.type === 'FeatureCollection' 
                ? layer.features 
                : [layer];
              allFeatures = allFeatures.concat(features);
            });
          } else {
            allFeatures = geojson.type === 'FeatureCollection' 
              ? geojson.features 
              : [geojson];
          }
          
          setFeatures(allFeatures.map(f => ({
            ...f,
            properties: {
              ...f.properties,
              layer_name: layerName,
              domain_name: domain
            }
          })));
          setStep(4);
        } else if (fileExt === 'shp') {
          // For single .shp file, create an object with .shp property
          try {
            const arrayBuffer = await file.arrayBuffer();
            // shpjs expects an object with .shp property for single file
            const geojson = await shp({ shp: arrayBuffer });
            
            let allFeatures = [];
            if (Array.isArray(geojson)) {
              geojson.forEach(layer => {
                const features = layer.type === 'FeatureCollection' 
                  ? layer.features 
                  : [layer];
                allFeatures = allFeatures.concat(features);
              });
            } else {
              allFeatures = geojson.type === 'FeatureCollection' 
                ? geojson.features 
                : [geojson];
            }
            
            setFeatures(allFeatures.map(f => ({
              ...f,
              properties: {
                ...f.properties,
                layer_name: layerName,
                domain_name: domain
              }
            })));
            setStep(4);
          } catch (shpError) {
            console.warn('Single .shp file processing failed:', shpError);
            alert('Single .shp file could not be processed completely. Geometry loaded but attributes may be missing. For full data, please upload a .zip file or select all components (.shp, .dbf, .shx, .prj) together.');
            // If there's partial data, still show it
            if (features.length > 0) {
              setStep(4);
            }
          }
        } else {
          alert('For single file upload, please use GeoJSON (.geojson, .json), Zipped Shapefile (.zip), or Shapefile (.shp). For complete shapefiles, select all files (.shp, .dbf, .shx, .prj) together.');
        }
      } else {
        // Multiple files selected - assume shapefile components
        // Create a proper structure for shpjs
        const fileMap = {};
        let baseName = null;
        
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const arrayBuffer = await file.arrayBuffer();
          const ext = file.name.toLowerCase().split('.').pop();
          
          // Get base name from .shp file
          if (ext === 'shp' && !baseName) {
            baseName = file.name.substring(0, file.name.lastIndexOf('.'));
          }
          
          // Store with extension as key (shpjs expects this format)
          fileMap[ext] = arrayBuffer;
        }
        
        // Check if we have the required .shp file
        if (!fileMap['shp']) {
          alert('Please include the .shp file when uploading shapefile components.');
          setIsProcessing(false);
          return;
        }
        
        // Use shpjs with the file map - it expects keys like 'shp', 'dbf', 'shx', 'prj'
        const geojson = await shp(fileMap);
        
        let allFeatures = [];
        if (Array.isArray(geojson)) {
          geojson.forEach(layer => {
            const features = layer.type === 'FeatureCollection' 
              ? layer.features 
              : [layer];
            allFeatures = allFeatures.concat(features);
          });
        } else {
          allFeatures = geojson.type === 'FeatureCollection' 
            ? geojson.features 
            : [geojson];
        }
        
        setFeatures(allFeatures.map(f => ({
          ...f,
          properties: {
            ...f.properties,
            layer_name: layerName,
            domain_name: domain
          }
        })));
        setStep(4);
      }
    } catch (error) {
      console.error('Error processing file:', error);
      let errorMessage = 'Error processing file';
      
      if (error.message.includes('no layers found')) {
        errorMessage = 'No valid geographic data found in the file. Please ensure the file contains valid shapefile or GeoJSON data.';
      } else if (error.message.includes('must be a string')) {
        errorMessage = 'Invalid file format. For shapefiles, please upload a .zip file or select all components together.';
      } else {
        errorMessage = 'Error processing file: ' + error.message;
      }
      
      alert(errorMessage);
      
      // Reset file input so user can try again
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      setUploadedFile(null);
      setUploadedFileCount(0);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSave = () => {
    if (features.length === 0) {
      alert('Please add at least one feature before saving');
      return;
    }

    onSave({
      name: layerName,
      icon: layerIcon,
      domain: domain,
      features: features
    });
  };

  const handleClose = () => {
    // Clean up maps if they exist
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }
    if (reviewMapInstanceRef.current) {
      reviewMapInstanceRef.current.remove();
      reviewMapInstanceRef.current = null;
    }
    
    setStep(1);
    setLayerName('');
    setLayerIcon('fas fa-map-marker-alt');
    setDataSource('upload');
    setUploadedFile(null);
    setUploadedFileCount(0);
    setFeatures([]);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="modal-overlay" onClick={(e) => {
        if (e.target.className === 'modal-overlay') handleClose();
      }}>
        <motion.div 
          className={`modal-content ${step === 3 && dataSource === 'draw' ? 'map-mode' : ''}`}
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        >
          <div className="modal-header">
            <h3>{editingLayer ? 'Edit Layer' : 'Add New Layer'}</h3>
            <button className="modal-close" onClick={handleClose}>
              <i className="fas fa-times"></i>
            </button>
          </div>

          <div className="layer-form">
            {step === 1 && (
              <>
                <div className="form-group">
                  <label>Layer Name *</label>
                  <input
                    type="text"
                    value={layerName}
                    onChange={(e) => setLayerName(e.target.value)}
                    placeholder="e.g., community_centers"
                    pattern="[a-z_]+"
                  />
                  <small>Use lowercase letters and underscores only</small>
                </div>

                <div className="form-group">
                  <label>Icon</label>
                  <div className="icon-selector">
                    {availableIcons.map(icon => (
                      <button
                        key={icon}
                        className={`icon-option ${layerIcon === icon ? 'selected' : ''}`}
                        onClick={() => setLayerIcon(icon)}
                        type="button"
                      >
                        <i className={icon}></i>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="form-actions">
                  <button className="btn-secondary" onClick={handleClose}>
                    Cancel
                  </button>
                  <button 
                    className="btn-primary" 
                    onClick={() => setStep(2)}
                    disabled={!layerName.match(/^[a-z_]+$/)}
                  >
                    Next <i className="fas fa-arrow-right"></i>
                  </button>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <div className="data-source-selection">
                  <button
                    className={`source-option ${dataSource === 'upload' ? 'selected' : ''}`}
                    onClick={() => setDataSource('upload')}
                  >
                    <i className="fas fa-upload"></i>
                    <h4>Upload File</h4>
                    <p>Upload GeoJSON or Shapefile</p>
                  </button>
                  <button
                    className={`source-option ${dataSource === 'draw' ? 'selected' : ''}`}
                    onClick={() => setDataSource('draw')}
                  >
                    <i className="fas fa-draw-polygon"></i>
                    <h4>Draw on Map</h4>
                    <p>Manually draw features</p>
                  </button>
                </div>

                <div className="form-actions">
                  <button className="btn-secondary" onClick={() => setStep(1)}>
                    <i className="fas fa-arrow-left"></i> Back
                  </button>
                  <button className="btn-primary" onClick={() => setStep(3)}>
                    Next <i className="fas fa-arrow-right"></i>
                  </button>
                </div>
              </>
            )}

            {step === 3 && (
              <>
                {dataSource === 'upload' ? (
                  <div className="upload-section">
                    <div className="upload-area" onClick={() => fileInputRef.current?.click()}>
                      <i className="fas fa-cloud-upload-alt"></i>
                      <h4>Click to upload or drag and drop</h4>
                      <p>GeoJSON (.geojson, .json) or Shapefile (.zip, .shp .dbf, .shx, .prj)</p>
                      {uploadedFile && <p className="uploaded-file">📁 {uploadedFile.name}</p>}
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".geojson,.json,.zip,.shp,.dbf,.shx,.prj"
                      onChange={handleFileUpload}
                      multiple
                      style={{ display: 'none' }}
                    />
                    {isProcessing && (
                      <div className="processing-indicator">
                        <i className="fas fa-spinner fa-spin"></i> Processing file...
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="draw-section">
                    <div ref={mapRef} style={{ height: '500px', borderRadius: '8px' }}></div>
                    <div className="draw-instructions">
                      <p><i className="fas fa-info-circle"></i> Use the drawing tools on the map to add features. Features: {features.length}</p>
                    </div>
                  </div>
                )}

                <div className="form-actions">
                  <button className="btn-secondary" onClick={() => setStep(2)}>
                    <i className="fas fa-arrow-left"></i> Back
                  </button>
                  {dataSource === 'draw' && (
                    <button 
                      className="btn-primary" 
                      onClick={handleSave}
                      disabled={features.length === 0}
                    >
                      <i className="fas fa-save"></i> Save Layer
                    </button>
                  )}
                </div>
              </>
            )}

            {step === 4 && (
              <>
                <div className="review-section">
                  <div className="review-summary">
                    <i className="fas fa-check-circle" style={{ color: '#10b981', fontSize: '48px' }}></i>
                    <h4>File processed successfully!</h4>
                    <p>{features.length} feature{features.length !== 1 ? 's' : ''} loaded</p>
                  </div>
                  
                  <div className="review-map-container">
                    <div ref={reviewMapRef} style={{ height: '500px', borderRadius: '8px', marginTop: '20px' }}></div>
                    <div className="draw-instructions" style={{ marginTop: '10px' }}>
                      <p><i className="fas fa-info-circle"></i> Review and edit your features using the map tools. You can add, edit, or delete features. Current features: {features.length}</p>
                    </div>
                  </div>
                </div>

                <div className="form-actions">
                  <button className="btn-secondary" onClick={() => {
                    // Clean up review map when going back
                    if (reviewMapInstanceRef.current) {
                      reviewMapInstanceRef.current.remove();
                      reviewMapInstanceRef.current = null;
                    }
                    setStep(3);
                  }}>
                    <i className="fas fa-arrow-left"></i> Back
                  </button>
                  <button className="btn-primary" onClick={handleSave} disabled={features.length === 0}>
                    <i className="fas fa-save"></i> Save Layer
                  </button>
                </div>
              </>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export default LayerModal;
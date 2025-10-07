import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import 'leaflet-draw';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import 'leaflet.markercluster';
import shp from 'shpjs';
import Papa from 'papaparse';
import { readParquet } from 'parquet-wasm';
import { tableFromIPC } from 'apache-arrow';
import * as turf from '@turf/turf';
import { loadLayerForEditing } from '../utils/s3';
import '../styles/LayerModal.css';

const LayerModal = ({
  isOpen,
  onClose,
  editingLayer,
  domain,
  domainColor,
  existingLayers,
  onSave,
  cityBoundary,
  cityName
}) => {
  const [step, setStep] = useState(1);
  const [layerName, setLayerName] = useState('');
  const [layerIcon, setLayerIcon] = useState('fas fa-map-marker-alt');
  const [dataSource, setDataSource] = useState('upload');
  const [uploadedFile, setUploadedFile] = useState(null);
  const [features, setFeatures] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoadingExisting, setIsLoadingExisting] = useState(false);
  const [editingFeatureName, setEditingFeatureName] = useState(null);
  const [featureNameInput, setFeatureNameInput] = useState('');
  const [nameError, setNameError] = useState('');
  const [isCustomLayer, setIsCustomLayer] = useState(false);
  const [customLayerName, setCustomLayerName] = useState('');
  const [customLayerIcon, setCustomLayerIcon] = useState('fas fa-map-marker-alt');
  const [appendMode, setAppendMode] = useState(true);
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const drawnItemsRef = useRef(null);
  const centroidGroupRef = useRef(null);
  const fileInputRef = useRef(null);
  const reviewMapRef = useRef(null);
  const reviewMapInstanceRef = useRef(null);
  const reviewDrawnItemsRef = useRef(null);
  const reviewCentroidGroupRef = useRef(null);

  // Get predefined layers for the selected domain
  const predefinedLayers = useMemo(() => {
    const layerDefs = {
      mobility: [
        { name: 'roads', icon: 'fas fa-road' },
        { name: 'sidewalks', icon: 'fas fa-walking' },
        { name: 'parking', icon: 'fas fa-parking' },
        { name: 'transit_stops', icon: 'fas fa-bus' },
        { name: 'subways', icon: 'fas fa-subway' },
        { name: 'railways', icon: 'fas fa-train' },
        { name: 'airports', icon: 'fas fa-plane' },
        { name: 'bicycle_parking', icon: 'fas fa-bicycle' },
      ],
      governance: [
        { name: 'police', icon: 'fas fa-shield-alt' },
        { name: 'government_offices', icon: 'fas fa-landmark' },
        { name: 'fire_stations', icon: 'fas fa-fire-extinguisher' },
      ],
      health: [
        { name: 'hospitals', icon: 'fas fa-hospital' },
        { name: 'doctor_offices', icon: 'fas fa-user-md' },
        { name: 'dentists', icon: 'fas fa-tooth' },
        { name: 'clinics', icon: 'fas fa-clinic-medical' },
        { name: 'pharmacies', icon: 'fas fa-pills' },
        { name: 'acupuncture', icon: 'fas fa-hand-holding-heart' },
      ],
      economy: [
        { name: 'factories', icon: 'fas fa-industry' },
        { name: 'banks', icon: 'fas fa-university' },
        { name: 'shops', icon: 'fas fa-store' },
        { name: 'restaurants', icon: 'fas fa-utensils' },
      ],
      environment: [
        { name: 'parks', icon: 'fas fa-tree' },
        { name: 'open_green_spaces', icon: 'fas fa-leaf' },
        { name: 'nature', icon: 'fas fa-mountain' },
        { name: 'waterways', icon: 'fas fa-water' },
        { name: 'lakes', icon: 'fas fa-tint' },
      ],
      culture: [
        { name: 'tourist_attractions', icon: 'fas fa-camera' },
        { name: 'theme_parks', icon: 'fas fa-ticket' },
        { name: 'gyms', icon: 'fas fa-dumbbell' },
        { name: 'theatres', icon: 'fas fa-theater-masks' },
        { name: 'stadiums', icon: 'fas fa-futbol' },
        { name: 'places_of_worship', icon: 'fas fa-pray' },
      ],
      education: [
        { name: 'schools', icon: 'fas fa-school' },
        { name: 'universities', icon: 'fas fa-university' },
        { name: 'colleges', icon: 'fas fa-graduation-cap' },
        { name: 'libraries', icon: 'fas fa-book' },
      ],
      housing: [
        { name: 'houses', icon: 'fas fa-home' },
        { name: 'apartments', icon: 'fas fa-building' },
      ],
      social: [
        { name: 'bars', icon: 'fas fa-wine-glass-alt' },
        { name: 'cafes', icon: 'fas fa-coffee' },
        { name: 'leisure_facilities', icon: 'fas fa-dice' },
      ],
    };
    return layerDefs[domain] || [];
  }, [domain]);

  const availableIcons = [
    'fas fa-map-marker-alt', 'fas fa-heart', 'fas fa-star', 'fas fa-traffic-light', 'fas fa-wifi', 
    'fas fa-wheelchair', 'fas fa-baby', 'fas fa-toilet', 'fas fa-ban', 
    'fas fa-trash', 'fas fa-recycle', 'fas fa-helmet-safety', 'fas fa-taxi', 'fas fa-truck', 
    'fas fa-ferry', 'fas fa-helicopter', 'fas fa-shuttle-space', 'fas fa-anchor', 
    'fas fa-phone', 'fas fa-envelope', 'fas fa-gavel', 'fas fa-tower-cell', 'fas fa-tower-broadcast',  
    'fas fa-plug', 'fas fa-syringe', 'fas fa-monument', 'fas fa-landmark-dome', 
    'fas fa-tractor', 'fas fa-spa', 'fas fa-binoculars', 'fas fa-kiwi-bird', 'fas fa-fish',  
    'fas fa-umbrella-beach', 'fas fa-volcano', 'fas fa-tornado', 'fas fa-tents'
  ];

  // Validate GeoJSON feature
  const validateFeature = (feature, index) => {
    if (!feature || !feature.type || feature.type !== 'Feature') {
      console.warn(`Invalid feature at index ${index}: missing or invalid type`, feature);
      return false;
    }
    if (!feature.geometry || !feature.geometry.type || !feature.geometry.coordinates) {
      console.warn(`Invalid geometry at index ${index}:`, feature.geometry);
      return false;
    }
    if (feature.geometry.type === 'Point') {
      const [lon, lat] = feature.geometry.coordinates;
      if (isNaN(lon) || isNaN(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) {
        console.warn(`Invalid point coordinates at index ${index}:`, [lon, lat]);
        return false;
      }
    } else if (['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString'].includes(feature.geometry.type)) {
      const coords = feature.geometry.coordinates;
      if (!Array.isArray(coords) || coords.length === 0) {
        console.warn(`Invalid coordinates for ${feature.geometry.type} at index ${index}:`, coords);
        return false;
      }
    }
    return true;
  };

  // Function to properly crop features by boundary using Turf.js
  const cropFeatureByBoundary = useCallback((feature, boundaryGeojson) => {
    if (!boundaryGeojson) return feature; // No boundary = include all features
    
    try {
      const boundary = typeof boundaryGeojson === 'string' 
        ? JSON.parse(boundaryGeojson) 
        : boundaryGeojson;
      
      // Create proper Turf feature from boundary
      const boundaryFeature = {
        type: 'Feature',
        geometry: boundary.geometry || boundary,
        properties: {}
      };
      
      // Create Turf feature from input
      const turfFeature = {
        type: 'Feature',
        geometry: feature.geometry,
        properties: feature.properties || {}
      };
      
      // Check if feature intersects with boundary
      const intersects = turf.booleanIntersects(turfFeature, boundaryFeature);
      
      if (!intersects) {
        return null; // Feature is completely outside boundary
      }
      
      // Crop based on geometry type
      if (feature.geometry.type === 'Point') {
        // For points, check if within boundary
        const isWithin = turf.booleanPointInPolygon(turfFeature, boundaryFeature);
        return isWithin ? feature : null;
        
      } else if (feature.geometry.type === 'LineString' || feature.geometry.type === 'MultiLineString') {
        // For lines, keep if they intersect (full line clipping would require additional logic)
        return feature;
        
      } else if (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon') {
        // For polygons, compute intersection
        try {
          const intersection = turf.intersect(turfFeature, boundaryFeature);
          if (intersection && intersection.geometry) {
            return {
              ...feature,
              geometry: intersection.geometry
            };
          }
          return null;
        } catch (intersectError) {
          console.warn('Error computing intersection, keeping original feature:', intersectError);
          return feature;
        }
      }
      
      return feature;
      
    } catch (error) {
      console.error('Error cropping feature by boundary:', error);
      return feature; // Return original feature if there's an error
    }
  }, []);

  // Function to remove duplicate features
  const removeDuplicateFeatures = (features) => {
    const uniqueFeatures = [];
    const seenCoordinates = new Set();
    
    features.forEach(feature => {
      const coordString = JSON.stringify(feature.geometry.coordinates);
      if (!seenCoordinates.has(coordString)) {
        seenCoordinates.add(coordString);
        uniqueFeatures.push(feature);
      }
    });
    
    console.log(`Removed ${features.length - uniqueFeatures.length} duplicate features`);
    return uniqueFeatures;
  };

  // Update popup content for map features
  const updatePopupContent = useCallback((layer, feature, index, finalLayerName, domain) => {
    const featureName = feature.properties?.name || feature.properties?.feature_name || `Feature ${index + 1}`;
    layer.bindPopup(`
      <div style="font-family: Inter, sans-serif;">
        <h4 style="margin: 0 0 8px 0; color: #1a202c; font-size: 14px;">
          ${featureName}
        </h4>
        <p style="margin: 0; color: #64748b; font-size: 12px;">
          <strong>Layer:</strong> ${finalLayerName}<br>
          <strong>Domain:</strong> ${domain}${feature.geometry.type !== 'Point' ? `<br><strong>Type:</strong> ${feature.geometry.type}` : ''}
        </p>
        <button class="edit-feature-btn" data-feature-index="${index}" 
          style="margin-top: 8px; padding: 4px 8px; background: #0891b2; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">
          <i class="fas fa-edit"></i> Edit Name
        </button>
      </div>
    `);
  }, []);

  // Update features from map layers (for EDITED and DELETED events)
  const updateFeaturesFromMap = useCallback((drawnItems) => {
    const finalLayerName = isCustomLayer ? customLayerName : layerName;
    const newFeatures = [];
    drawnItems.eachLayer(layer => {
      const geojson = layer.toGeoJSON();
      const featureIndex = newFeatures.length;
      const existingFeature = features[featureIndex] || {};
      const featureName = existingFeature.properties?.name ||
                         existingFeature.properties?.feature_name ||
                         `Feature ${featureIndex + 1}`;

      const newFeature = {
        type: 'Feature',
        geometry: geojson.geometry,
        properties: {
          name: featureName,
          feature_name: featureName,
          layer_name: finalLayerName,
          domain_name: domain
        }
      };

      if (validateFeature(newFeature, featureIndex)) {
        newFeatures.push(newFeature);
        console.log(`Updated feature at index ${featureIndex}:`, newFeature);
      }
    });
    setFeatures(newFeatures);
    console.log('Updated features from map:', newFeatures);
  }, [layerName, customLayerName, isCustomLayer, domain, features]);

  const updateReviewFeaturesFromMap = useCallback(() => {
    updateFeaturesFromMap(reviewDrawnItemsRef.current);
  }, [updateFeaturesFromMap]);

  // Validate layer name
  const validateLayerName = (name) => {
    if (!name.match(/^[a-z_]+$/)) {
      return 'Layer name must contain only lowercase letters and underscores';
    }
    if (existingLayers.some(layer => layer.name === name && (!editingLayer || editingLayer.name !== name))) {
      return 'A layer with this name already exists in this domain';
    }
    return '';
  };

  const handleLayerNameChange = (e) => {
    const name = e.target.value;
    setCustomLayerName(name);
    setNameError(validateLayerName(name));
  };

  const handleLayerSelection = (e) => {
    const value = e.target.value;
    if (value === 'custom') {
      setIsCustomLayer(true);
      setLayerName('');
      setLayerIcon('fas fa-map-marker-alt');
      setCustomLayerName('');
      setCustomLayerIcon('fas fa-map-marker-alt');
    } else {
      setIsCustomLayer(false);
      const selectedLayer = predefinedLayers.find(l => l.name === value);
      if (selectedLayer) {
        setLayerName(selectedLayer.name);
        setLayerIcon(selectedLayer.icon);
      }
    }
  };

  // Load existing layer data for editing
  useEffect(() => {
    const loadExistingLayerData = async () => {
      if (!cityName || !domain) {
        console.warn('cityName or domain is undefined');
        return;
      }

      if (editingLayer) {
        setIsLoadingExisting(true);
        setLayerName(editingLayer.name);
        setLayerIcon(editingLayer.icon);
        setIsCustomLayer(false);

        // Check if it's a custom layer (not in predefinedLayers)
        const isPredefined = predefinedLayers.some(l => l.name === editingLayer.name);
        if (!isPredefined) {
          setIsCustomLayer(true);
          setCustomLayerName(editingLayer.name);
          setCustomLayerIcon(editingLayer.icon);
        }

        try {
          const loadedFeatures = await loadLayerForEditing(
            cityName,
            domain,
            editingLayer.name
          );

          const validFeatures = (loadedFeatures || []).filter((f, i) => validateFeature(f, i));
          setFeatures(validFeatures);
          setStep(3);
          setDataSource('draw');
          console.log('Loaded existing features:', validFeatures);
        } catch (error) {
          console.error('Error loading layer for editing:', error);
          alert('Failed to load layer data for editing');
          setFeatures([]);
        } finally {
          setIsLoadingExisting(false);
        }
      } else {
        setStep(1);
        setLayerName('');
        setLayerIcon('fas fa-map-marker-alt');
        setDataSource('upload');
        setUploadedFile(null);
        setFeatures([]);
        setIsCustomLayer(false);
        setCustomLayerName('');
        setCustomLayerIcon('fas fa-map-marker-alt');
      }
    };

    if (isOpen) {
      loadExistingLayerData();
    }
  }, [editingLayer, isOpen, domain, cityName, predefinedLayers]);

  // Initialize drawing map (step 3)
  useEffect(() => {
    if (
      step !== 3 ||
      dataSource !== 'draw' ||
      !mapRef.current ||
      mapInstanceRef.current ||
      isLoadingExisting
    ) {
      return;
    }

    const finalLayerName = isCustomLayer ? customLayerName : layerName;
    const finalLayerIcon = isCustomLayer ? customLayerIcon : layerIcon;

    console.log('Initializing drawing map');

    const initializeMap = () => {
      if (!mapRef.current) {
        console.error('mapRef.current is null, cannot initialize map');
        return;
      }

      const map = L.map(mapRef.current, {
        zoomControl: true,
        minZoom: 2,
        maxZoom: 18
      }).setView([43.4643, -80.5204], 12);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(map);

      setTimeout(() => {
        map.invalidateSize();
        console.log('Drawing map initialized:', map);
      }, 100);

      let boundaryLayer = null;
      if (cityBoundary) {
        try {
          let boundaryGeojson;
          
          if (typeof cityBoundary === 'string') {
            boundaryGeojson = JSON.parse(cityBoundary);
          } else {
            boundaryGeojson = cityBoundary;
          }
          
          boundaryLayer = L.geoJSON(boundaryGeojson, {
            style: {
              color: '#0891b2',
              weight: 2,
              opacity: 0.6,
              fillOpacity: 0.05
            }
          });
          
          boundaryLayer.addTo(map);
          console.log('City boundary added to drawing map');
        } catch (error) {
          console.error('Could not display city boundary:', error);
        }
      }

      const drawnItems = new L.FeatureGroup();
      map.addLayer(drawnItems);
      drawnItemsRef.current = drawnItems;

      const centroidGroup = new L.FeatureGroup();
      map.addLayer(centroidGroup);
      centroidGroupRef.current = centroidGroup;

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
                z-index: 1000;
              ">
                <i class="${finalLayerIcon}"></i>
              </div>`,
              iconSize: [28, 28],
              iconAnchor: [14, 14]
            })
          }
        }
      });
      map.addControl(drawControl);

      // Add initial features
      features.forEach((feature, index) => {
        if (validateFeature(feature, index)) {
          if (feature.geometry.type === 'Point') {
            const [lon, lat] = feature.geometry.coordinates;
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
                  z-index: 1000;
                ">
                  <i class="${finalLayerIcon}"></i>
                </div>`,
                iconSize: [28, 28],
                iconAnchor: [14, 14]
              })
            });
            updatePopupContent(marker, feature, index, finalLayerName, domain);
            drawnItems.addLayer(marker);
            console.log(`Drawing map: Added point feature at index ${index}:`, feature);
          } else {
            const geoJsonLayer = L.geoJSON(feature.geometry, {
              style: {
                color: domainColor,
                weight: 3,
                opacity: 0.9,
                fillColor: domainColor,
                fillOpacity: 0.3
              }
            });
            updatePopupContent(geoJsonLayer, feature, index, finalLayerName, domain);
            geoJsonLayer.eachLayer(l => {
              drawnItems.addLayer(l);
            });
            console.log(`Drawing map: Added non-point feature at index ${index}:`, feature);

            try {
              const tempLayer = L.geoJSON(feature.geometry);
              const bounds = tempLayer.getBounds();
              if (bounds.isValid()) {
                const centroid = bounds.getCenter();
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
                      z-index: 1000;
                    ">
                      <i class="${finalLayerIcon}"></i>
                    </div>`,
                    iconSize: [28, 28],
                    iconAnchor: [14, 14]
                  })
                });
                updatePopupContent(centroidMarker, feature, index, finalLayerName, domain);
                centroidGroup.addLayer(centroidMarker);
                console.log(`Drawing map: Added centroid for feature at index ${index}`);
              }
            } catch (error) {
              console.error(`Drawing map: Error adding centroid at index ${index}:`, error);
            }
          }
        }
      });

      if (drawnItems.getLayers().length > 0 || boundaryLayer) {
        let bounds;
        
        if (drawnItems.getLayers().length > 0 && boundaryLayer) {
          // Combine bounds of features and boundary
          const featureBounds = drawnItems.getBounds();
          bounds = featureBounds.extend(boundaryLayer.getBounds());
        } else if (drawnItems.getLayers().length > 0) {
          bounds = drawnItems.getBounds();
        } else if (boundaryLayer) {
          bounds = boundaryLayer.getBounds();
        }
        
        if (bounds) {
          map.fitBounds(bounds, { padding: [20, 20] });
        }
      }

      map.on('popupopen', (e) => {
        const popup = e.popup;
        const editButton = popup._contentNode.querySelector('.edit-feature-btn');
        if (editButton) {
          editButton.addEventListener('click', () => {
            const featureIndex = parseInt(editButton.dataset.featureIndex);
            const feature = features[featureIndex];
            const currentName = feature.properties?.name || feature.properties?.feature_name || '';
            setEditingFeatureName(featureIndex);
            setFeatureNameInput(currentName);
          });
        }
      });

      map.on(L.Draw.Event.CREATED, (e) => {
        const layer = e.layer;
        const geojson = layer.toGeoJSON();
        const featureIndex = features.length;
        
        const newFeature = {
          type: 'Feature',
          geometry: geojson.geometry,
          properties: {
            name: `Feature ${featureIndex + 1}`,
            feature_name: `Feature ${featureIndex + 1}`,
            layer_name: finalLayerName,
            domain_name: domain
          }
        };
        
        // Crop feature by boundary before adding
        const croppedFeature = cropFeatureByBoundary(newFeature, cityBoundary);
        
        if (croppedFeature && validateFeature(croppedFeature, featureIndex)) {
          drawnItems.addLayer(layer);
          setFeatures(prev => [...prev, croppedFeature]);
          console.log('Feature created and cropped to boundary:', croppedFeature);
          updatePopupContent(layer, croppedFeature, featureIndex, finalLayerName, domain);
        } else {
          console.warn('Feature is outside city boundary, not adding:', newFeature);
          alert('Feature is outside the city boundary and was not added.');
        }
      });

      map.on(L.Draw.Event.EDITED, () => {
        console.log('Features edited in drawing map');
        updateFeaturesFromMap(drawnItemsRef.current);
      });

      map.on(L.Draw.Event.DELETED, () => {
        console.log('Features deleted in drawing map');
        updateFeaturesFromMap(drawnItemsRef.current);
      });

      mapInstanceRef.current = map;
    };

    setTimeout(initializeMap, 100);

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        console.log('Drawing map cleaned up');
      }
    };
  }, [step, dataSource, cityBoundary, domainColor, layerIcon, layerName, domain, isLoadingExisting, features, updatePopupContent, updateFeaturesFromMap, isCustomLayer, customLayerIcon, customLayerName, cropFeatureByBoundary]);

  // Initialize review map (step 4)
  useEffect(() => {
    if (
      step !== 4 ||
      !reviewMapRef.current ||
      reviewMapInstanceRef.current ||
      features.length === 0
    ) {
      return;
    }

    const finalLayerName = isCustomLayer ? customLayerName : layerName;
    const finalLayerIcon = isCustomLayer ? customLayerIcon : layerIcon;

    console.log('Initializing review map');

    const initializeReviewMap = () => {
      if (!reviewMapRef.current) {
        console.error('reviewMapRef.current is null, cannot initialize review map');
        return;
      }

      const map = L.map(reviewMapRef.current, {
        zoomControl: true,
        minZoom: 2,
        maxZoom: 18
      }).setView([43.4643, -80.5204], 12);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(map);

      setTimeout(() => {
        map.invalidateSize();
        console.log('Review map initialized:', map);
      }, 100);

      let reviewBoundaryLayer = null;
      if (cityBoundary) {
        try {
          let boundaryGeojson;
          
          if (typeof cityBoundary === 'string') {
            boundaryGeojson = JSON.parse(cityBoundary);
          } else {
            boundaryGeojson = cityBoundary;
          }
          
          reviewBoundaryLayer = L.geoJSON(boundaryGeojson, {
            style: {
              color: '#0891b2',
              weight: 2,
              opacity: 0.6,
              fillOpacity: 0.05
            }
          });
          
          reviewBoundaryLayer.addTo(map);
          console.log('City boundary added to review map');
        } catch (error) {
          console.error('Could not display city boundary:', error);
        }
      }

      const drawnItems = new L.FeatureGroup();
      map.addLayer(drawnItems);
      reviewDrawnItemsRef.current = drawnItems;

      const centroidGroup = new L.FeatureGroup();
      map.addLayer(centroidGroup);
      reviewCentroidGroupRef.current = centroidGroup;

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
                z-index: 1000;
              ">
                <i class="${finalLayerIcon}"></i>
              </div>`,
              iconSize: [28, 28],
              iconAnchor: [14, 14]
            })
          }
        }
      });
      map.addControl(drawControl);

      // Add initial features
      features.forEach((feature, index) => {
        if (validateFeature(feature, index)) {
          if (feature.geometry.type === 'Point') {
            const [lon, lat] = feature.geometry.coordinates;
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
                  z-index: 1000;
                ">
                  <i class="${finalLayerIcon}"></i>
                </div>`,
                iconSize: [28, 28],
                iconAnchor: [14, 14]
              })
            });
            updatePopupContent(marker, feature, index, finalLayerName, domain);
            drawnItems.addLayer(marker);
            console.log(`Review map: Added point feature at index ${index}:`, feature);
          } else {
            const geoJsonLayer = L.geoJSON(feature.geometry, {
              style: {
                color: domainColor,
                weight: 3,
                opacity: 0.9,
                fillColor: domainColor,
                fillOpacity: 0.3
              }
            });
            updatePopupContent(geoJsonLayer, feature, index, finalLayerName, domain);
            geoJsonLayer.eachLayer(l => {
              drawnItems.addLayer(l);
            });
            console.log(`Review map: Added non-point feature at index ${index}:`, feature);

            try {
              const tempLayer = L.geoJSON(feature.geometry);
              const bounds = tempLayer.getBounds();
              if (bounds.isValid()) {
                const centroid = bounds.getCenter();
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
                      z-index: 1000;
                    ">
                      <i class="${finalLayerIcon}"></i>
                    </div>`,
                    iconSize: [28, 28],
                    iconAnchor: [14, 14]
                  })
                });
                updatePopupContent(centroidMarker, feature, index, finalLayerName, domain);
                centroidGroup.addLayer(centroidMarker);
                console.log(`Review map: Added centroid for feature at index ${index}`);
              }
            } catch (error) {
              console.error(`Review map: Error adding centroid at index ${index}:`, error);
            }
          }
        }
      });

      if (drawnItems.getLayers().length > 0 || reviewBoundaryLayer) {
        let bounds;
        
        if (drawnItems.getLayers().length > 0 && reviewBoundaryLayer) {
          // Combine bounds of features and boundary
          const featureBounds = drawnItems.getBounds();
          bounds = featureBounds.extend(reviewBoundaryLayer.getBounds());
        } else if (drawnItems.getLayers().length > 0) {
          bounds = drawnItems.getBounds();
        } else if (reviewBoundaryLayer) {
          bounds = reviewBoundaryLayer.getBounds();
        }
        
        if (bounds) {
          map.fitBounds(bounds, { padding: [50, 50] });
        }
      }

      map.on('popupopen', (e) => {
        const popup = e.popup;
        const editButton = popup._contentNode.querySelector('.edit-feature-btn');
        if (editButton) {
          editButton.addEventListener('click', () => {
            const featureIndex = parseInt(editButton.dataset.featureIndex);
            const feature = features[featureIndex];
            const currentName = feature.properties?.name || feature.properties?.feature_name || '';
            setEditingFeatureName(featureIndex);
            setFeatureNameInput(currentName);
          });
        }
      });

      map.on(L.Draw.Event.CREATED, (e) => {
        const layer = e.layer;
        const geojson = layer.toGeoJSON();
        const featureIndex = features.length;
        
        const newFeature = {
          type: 'Feature',
          geometry: geojson.geometry,
          properties: {
            name: `Feature ${featureIndex + 1}`,
            feature_name: `Feature ${featureIndex + 1}`,
            layer_name: finalLayerName,
            domain_name: domain
          }
        };
        
        // Crop feature by boundary before adding
        const croppedFeature = cropFeatureByBoundary(newFeature, cityBoundary);
        
        if (croppedFeature && validateFeature(croppedFeature, featureIndex)) {
          drawnItems.addLayer(layer);
          setFeatures(prev => [...prev, croppedFeature]);
          console.log('Feature created in review map and cropped:', croppedFeature);
          updatePopupContent(layer, croppedFeature, featureIndex, finalLayerName, domain);
        } else {
          console.warn('Feature is outside city boundary in review map:', newFeature);
          alert('Feature is outside the city boundary and was not added.');
        }
      });

      map.on(L.Draw.Event.EDITED, () => {
        console.log('Features edited in review map');
        updateReviewFeaturesFromMap();
      });

      map.on(L.Draw.Event.DELETED, () => {
        console.log('Features deleted in review map');
        updateReviewFeaturesFromMap();
      });

      reviewMapInstanceRef.current = map;
    };

    setTimeout(initializeReviewMap, 100);

    return () => {
      if (reviewMapInstanceRef.current) {
        reviewMapInstanceRef.current.remove();
        reviewMapInstanceRef.current = null;
        console.log('Review map cleaned up');
      }
    };
  }, [step, cityBoundary, domainColor, layerIcon, layerName, domain, features, updatePopupContent, updateReviewFeaturesFromMap, isCustomLayer, customLayerIcon, customLayerName, cropFeatureByBoundary]);

  useEffect(() => {
    if (step === 4 && reviewMapInstanceRef.current && features.length > 0) {
      const finalLayerName = isCustomLayer ? customLayerName : layerName;
      const finalLayerIcon = isCustomLayer ? customLayerIcon : layerIcon;
  
      // Clear existing layers
      if (reviewDrawnItemsRef.current) {
        reviewDrawnItemsRef.current.clearLayers();
      }
      if (reviewCentroidGroupRef.current) {
        reviewCentroidGroupRef.current.clearLayers();
      }
  
      // Re-add all features
      features.forEach((feature, index) => {
        if (validateFeature(feature, index)) {
          if (feature.geometry.type === 'Point') {
            const [lon, lat] = feature.geometry.coordinates;
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
                  z-index: 1000;
                ">
                  <i class="${finalLayerIcon}"></i>
                </div>`,
                iconSize: [28, 28],
                iconAnchor: [14, 14]
              })
            });
            updatePopupContent(marker, feature, index, finalLayerName, domain);
            reviewDrawnItemsRef.current.addLayer(marker);
          } else {
            const geoJsonLayer = L.geoJSON(feature.geometry, {
              style: {
                color: domainColor,
                weight: 3,
                opacity: 0.9,
                fillColor: domainColor,
                fillOpacity: 0.3
              }
            });
            updatePopupContent(geoJsonLayer, feature, index, finalLayerName, domain);
            geoJsonLayer.eachLayer(l => {
              reviewDrawnItemsRef.current.addLayer(l);
            });
  
            try {
              const tempLayer = L.geoJSON(feature.geometry);
              const bounds = tempLayer.getBounds();
              if (bounds.isValid()) {
                const centroid = bounds.getCenter();
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
                      z-index: 1000;
                    ">
                      <i class="${finalLayerIcon}"></i>
                    </div>`,
                    iconSize: [28, 28],
                    iconAnchor: [14, 14]
                  })
                });
                updatePopupContent(centroidMarker, feature, index, finalLayerName, domain);
                reviewCentroidGroupRef.current.addLayer(centroidMarker);
              }
            } catch (error) {
              console.error(`Error adding centroid at index ${index}:`, error);
            }
          }
        }
      });
  
      // Fit bounds to show all features
      if (reviewDrawnItemsRef.current.getLayers().length > 0) {
        const bounds = reviewDrawnItemsRef.current.getBounds();
        reviewMapInstanceRef.current.fitBounds(bounds, { padding: [50, 50] });
      }
  
      console.log('Review map refreshed with updated features:', features.length);
    }
  }, [features, step, domainColor, layerIcon, layerName, domain, isCustomLayer, customLayerIcon, customLayerName, updatePopupContent]);

  // Update feature name
  const updateFeatureName = () => {
    if (editingFeatureName === null) return;

    const finalLayerName = isCustomLayer ? customLayerName : layerName;

    const updatedFeatures = [...features];
    updatedFeatures[editingFeatureName] = {
      ...updatedFeatures[editingFeatureName],
      properties: {
        ...updatedFeatures[editingFeatureName].properties,
        name: featureNameInput,
        feature_name: featureNameInput
      }
    };
    setFeatures(updatedFeatures);
    setEditingFeatureName(null);
    setFeatureNameInput('');

    const refreshPopups = (drawnItems, centroidGroup) => {
      if (drawnItems) {
        drawnItems.eachLayer(layer => {
          const featureIndex = Array.from(drawnItems.getLayers()).indexOf(layer);
          if (featureIndex >= 0 && updatedFeatures[featureIndex]) {
            updatePopupContent(layer, updatedFeatures[featureIndex], featureIndex, finalLayerName, domain);
            if (layer.isPopupOpen()) {
              layer.openPopup();
            }
          }
        });
      }
      if (centroidGroup) {
        centroidGroup.eachLayer(layer => {
          const featureIndex = Array.from(centroidGroup.getLayers()).indexOf(layer);
          if (featureIndex >= 0 && updatedFeatures[featureIndex]) {
            updatePopupContent(layer, updatedFeatures[featureIndex], featureIndex, finalLayerName, domain);
            if (layer.isPopupOpen()) {
              layer.openPopup();
            }
          }
        });
      }
    };

    refreshPopups(drawnItemsRef.current, centroidGroupRef.current);
    refreshPopups(reviewDrawnItemsRef.current, reviewCentroidGroupRef.current);
    console.log('Feature name updated:', updatedFeatures[editingFeatureName]);
  };

  // Handle file upload
  const handleFileUpload = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
  
    const finalLayerName = isCustomLayer ? customLayerName : layerName;
  
    setIsProcessing(true);
    
    try {
      let newFeatures = [];
      let totalParsed = 0;
      let totalCropped = 0;
  
      if (files.length === 1) {
        // Single file case
        const file = files[0];
        const fileExt = file.name.toLowerCase().split('.').pop();
  
        if (fileExt === 'csv') {
          const text = await file.text();
          Papa.parse(text, {
            header: true,
            dynamicTyping: true,
            skipEmptyLines: true,
            complete: (results) => {
              const parsedFeatures = results.data.map((row, idx) => {
                let geometry = null;
  
                if (row.geometry_coordinates) {
                  try {
                    geometry = JSON.parse(row.geometry_coordinates);
                  } catch (e) {
                    console.warn(`Could not parse geometry_coordinates at row ${idx}:`, e);
                  }
                } else if (row.longitude != null && row.latitude != null) {
                  geometry = {
                    type: 'Point',
                    coordinates: [parseFloat(row.longitude), parseFloat(row.latitude)]
                  };
                }
  
                if (!geometry || !validateFeature({ type: 'Feature', geometry }, idx)) {
                  return null;
                }
  
                return {
                  type: 'Feature',
                  geometry: geometry,
                  properties: {
                    name: row.feature_name || row.name || `Feature ${idx + 1}`,
                    feature_name: row.feature_name || row.name || `Feature ${idx + 1}`,
                    layer_name: finalLayerName,
                    domain_name: domain
                  }
                };
              }).filter(f => f !== null);
  
              totalParsed = parsedFeatures.length;
  
              // Crop by boundary
              const boundaryFiltered = parsedFeatures
                .map(f => cropFeatureByBoundary(f, cityBoundary))
                .filter(f => f !== null);
              
              totalCropped = totalParsed - boundaryFiltered.length;
              console.log(`CSV: ${totalParsed} features, ${boundaryFiltered.length} within/cropped to boundary (${totalCropped} removed)`);
  
              // Append or replace based on mode
              const combined = appendMode ? [...features, ...boundaryFiltered] : boundaryFiltered;
              const unique = removeDuplicateFeatures(combined);
              
              setFeatures(unique);
              setStep(4);
              
              if (totalCropped > 0) {
                alert(`Loaded ${unique.length} features. ${totalCropped} features were outside the city boundary and were removed.`);
              }
            }
          });
        } else if (fileExt === 'parquet') {
          const arrayBuffer = await file.arrayBuffer();
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
  
          const parsedFeatures = data.map((row, idx) => {
            let geometry = null;
  
            if (row.geometry_coordinates) {
              try {
                geometry = JSON.parse(row.geometry_coordinates);
              } catch (e) {
                console.warn(`Could not parse geometry_coordinates at row ${idx}:`, e);
              }
            } else if (row.longitude != null && row.latitude != null) {
              geometry = {
                type: 'Point',
                coordinates: [parseFloat(row.longitude), parseFloat(row.latitude)]
              };
            }
  
            if (!geometry || !validateFeature({ type: 'Feature', geometry }, idx)) {
              return null;
            }
  
            return {
              type: 'Feature',
              geometry: geometry,
              properties: {
                name: row.feature_name || row.name || `Feature ${idx + 1}`,
                feature_name: row.feature_name || row.name || `Feature ${idx + 1}`,
                layer_name: finalLayerName,
                domain_name: domain
              }
            };
          }).filter(f => f !== null);
  
          totalParsed = parsedFeatures.length;
  
          // Crop by boundary
          const boundaryFiltered = parsedFeatures
            .map(f => cropFeatureByBoundary(f, cityBoundary))
            .filter(f => f !== null);
          
          totalCropped = totalParsed - boundaryFiltered.length;
          console.log(`Parquet: ${totalParsed} features, ${boundaryFiltered.length} within/cropped to boundary (${totalCropped} removed)`);
  
          // Append or replace based on mode
          const combined = appendMode ? [...features, ...boundaryFiltered] : boundaryFiltered;
          const unique = removeDuplicateFeatures(combined);
          
          setFeatures(unique);
          setStep(4);
          
          if (totalCropped > 0) {
            alert(`Loaded ${unique.length} features. ${totalCropped} features were outside the city boundary and were removed.`);
          }
        } else if (fileExt === 'geojson' || fileExt === 'json') {
          const text = await file.text();
          const geojson = JSON.parse(text);
  
          const parsedFeatures = geojson.type === 'FeatureCollection'
            ? geojson.features
            : [geojson];
  
          const validFeatures = parsedFeatures
            .map((f, idx) => {
              if (!validateFeature(f, idx)) return null;
              return {
                ...f,
                properties: {
                  ...f.properties,
                  name: f.properties?.name || f.properties?.feature_name || `Feature ${idx + 1}`,
                  feature_name: f.properties?.name || f.properties?.feature_name || `Feature ${idx + 1}`,
                  layer_name: finalLayerName,
                  domain_name: domain
                }
              };
            })
            .filter(f => f !== null);
  
          totalParsed = validFeatures.length;
  
          // Crop by boundary
          const boundaryFiltered = validFeatures
            .map(f => cropFeatureByBoundary(f, cityBoundary))
            .filter(f => f !== null);
          
          totalCropped = totalParsed - boundaryFiltered.length;
          console.log(`GeoJSON: ${totalParsed} features, ${boundaryFiltered.length} within/cropped to boundary (${totalCropped} removed)`);
  
          // Append or replace based on mode
          const combined = appendMode ? [...features, ...boundaryFiltered] : boundaryFiltered;
          const unique = removeDuplicateFeatures(combined);
          
          setFeatures(unique);
          setStep(4);
          
          if (totalCropped > 0) {
            alert(`Loaded ${unique.length} features. ${totalCropped} features were outside the city boundary and were removed.`);
          }
        } else if (fileExt === 'zip') {
          const arrayBuffer = await file.arrayBuffer();
          const geojson = await shp(arrayBuffer);
  
          let parsedFeatures = [];
          if (Array.isArray(geojson)) {
            geojson.forEach(layer => {
              const feats = layer.type === 'FeatureCollection'
                ? layer.features
                : [layer];
              parsedFeatures = parsedFeatures.concat(feats);
            });
          } else {
            parsedFeatures = geojson.type === 'FeatureCollection'
              ? geojson.features
              : [geojson];
          }
  
          const validFeatures = parsedFeatures
            .map((f, idx) => {
              if (!validateFeature(f, idx)) return null;
              return {
                ...f,
                properties: {
                  ...f.properties,
                  name: f.properties?.name || f.properties?.feature_name || `Feature ${idx + 1}`,
                  feature_name: f.properties?.name || f.properties?.feature_name || `Feature ${idx + 1}`,
                  layer_name: finalLayerName,
                  domain_name: domain
                }
              };
            })
            .filter(f => f !== null);
  
          totalParsed = validFeatures.length;
  
          // Crop by boundary
          const boundaryFiltered = validFeatures
            .map(f => cropFeatureByBoundary(f, cityBoundary))
            .filter(f => f !== null);
          
          totalCropped = totalParsed - boundaryFiltered.length;
          console.log(`Shapefile (zip): ${totalParsed} features, ${boundaryFiltered.length} within/cropped to boundary (${totalCropped} removed)`);
  
          // Append or replace based on mode
          const combined = appendMode ? [...features, ...boundaryFiltered] : boundaryFiltered;
          const unique = removeDuplicateFeatures(combined);
          
          setFeatures(unique);
          setStep(4);
          
          if (totalCropped > 0) {
            alert(`Loaded ${unique.length} features. ${totalCropped} features were outside the city boundary and were removed.`);
          }
        } else if (fileExt === 'shp') {
          try {
            const arrayBuffer = await file.arrayBuffer();
            const geojson = await shp({ shp: arrayBuffer });
  
            let parsedFeatures = [];
            if (Array.isArray(geojson)) {
              geojson.forEach(layer => {
                const feats = layer.type === 'FeatureCollection'
                  ? layer.features
                  : [layer];
                parsedFeatures = parsedFeatures.concat(feats);
              });
            } else {
              parsedFeatures = geojson.type === 'FeatureCollection'
                ? geojson.features
                : [geojson];
            }
  
            const validFeatures = parsedFeatures
              .map((f, idx) => {
                if (!validateFeature(f, idx)) return null;
                return {
                  ...f,
                  properties: {
                    ...f.properties,
                    name: f.properties?.name || f.properties?.feature_name || `Feature ${idx + 1}`,
                    feature_name: f.properties?.name || f.properties?.feature_name || `Feature ${idx + 1}`,
                    layer_name: finalLayerName,
                    domain_name: domain
                  }
                };
              })
              .filter(f => f !== null);
  
            totalParsed = validFeatures.length;
  
            // Crop by boundary
            const boundaryFiltered = validFeatures
              .map(f => cropFeatureByBoundary(f, cityBoundary))
              .filter(f => f !== null);
            
            totalCropped = totalParsed - boundaryFiltered.length;
            console.log(`Shapefile (shp): ${totalParsed} features, ${boundaryFiltered.length} within/cropped to boundary (${totalCropped} removed)`);
  
            // Append or replace based on mode
            const combined = appendMode ? [...features, ...boundaryFiltered] : boundaryFiltered;
            const unique = removeDuplicateFeatures(combined);
            
            setFeatures(unique);
            setStep(4);
            
            if (totalCropped > 0) {
              alert(`Loaded ${unique.length} features. ${totalCropped} features were outside the city boundary and were removed.`);
            }
          } catch (shpError) {
            console.warn('Single .shp file processing failed:', shpError);
            alert('Single .shp file could not be processed completely. Geometry loaded but attributes may be missing. For full data, please upload a .zip file or select all components (.shp, .dbf, .shx, .prj) together.');
          }
        } else {
          alert('For single file upload, please use GeoJSON (.geojson, .json), CSV (.csv), Parquet (.parquet), Zipped Shapefile (.zip), or Shapefile (.shp). For complete shapefiles, select all files (.shp, .dbf, .shx, .prj) together.');
        }
      } else {
        // Multiple files case
        const fileGroups = {};
        const geojsonFiles = [];
        const zipFiles = [];
  
        // Categorize files and group shapefile components by base name
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const ext = file.name.toLowerCase().split('.').pop();
          const fileNameWithoutExt = file.name.substring(0, file.name.lastIndexOf('.'));
  
          if (['shp', 'dbf', 'shx', 'prj'].includes(ext)) {
            // Group shapefile components by their base name
            if (!fileGroups[fileNameWithoutExt]) {
              fileGroups[fileNameWithoutExt] = {};
            }
            fileGroups[fileNameWithoutExt][ext] = await file.arrayBuffer();
          } else if (ext === 'geojson' || ext === 'json') {
            geojsonFiles.push(file);
          } else if (ext === 'zip') {
            zipFiles.push(file);
          } else if (ext === 'csv' || ext === 'parquet') {
            alert('Multiple CSV or Parquet files are not supported for combining. Please upload one file at a time for these formats.');
            setIsProcessing(false);
            return;
          }
        }
  
        // Helper function to process and validate features
        const processFeatures = (parsedFeatures, currentCount) => {
          return parsedFeatures
            .map((f, idx) => {
              if (!validateFeature(f, idx)) return null;
              return {
                ...f,
                properties: {
                  ...f.properties,
                  name: f.properties?.name || f.properties?.feature_name || `Feature ${currentCount + idx + 1}`,
                  feature_name: f.properties?.name || f.properties?.feature_name || `Feature ${currentCount + idx + 1}`,
                  layer_name: finalLayerName,
                  domain_name: domain
                }
              };
            })
            .filter(f => f !== null);
        };
  
        // Process each shapefile group
        const shapefileGroupNames = Object.keys(fileGroups);
        for (const baseName of shapefileGroupNames) {
          const fileMap = fileGroups[baseName];
          
          if (fileMap['shp']) {
            try {
              const geojson = await shp(fileMap);
  
              let parsedFeatures = [];
              if (Array.isArray(geojson)) {
                geojson.forEach(layer => {
                  const feats = layer.type === 'FeatureCollection'
                    ? layer.features
                    : [layer];
                  parsedFeatures = parsedFeatures.concat(feats);
                });
              } else {
                parsedFeatures = geojson.type === 'FeatureCollection'
                  ? geojson.features
                  : [geojson];
              }
  
              const validFeatures = processFeatures(parsedFeatures, newFeatures.length);
              totalParsed += validFeatures.length;
              
              const boundaryFiltered = validFeatures
                .map(f => cropFeatureByBoundary(f, cityBoundary))
                .filter(f => f !== null);
              
              const cropped = validFeatures.length - boundaryFiltered.length;
              totalCropped += cropped;
              console.log(`Shapefile set "${baseName}": ${validFeatures.length} features, ${boundaryFiltered.length} within/cropped to boundary (${cropped} removed)`);
              
              newFeatures = newFeatures.concat(boundaryFiltered);
            } catch (shpError) {
              console.warn(`Error processing shapefile set "${baseName}":`,
                shpError);
              alert(`Error processing shapefile set "${baseName}". Please ensure all required files (.shp, .dbf, .shx, .prj) are uploaded together.`);
            }
          } else {
            console.warn(`Shapefile set "${baseName}" is missing .shp file`);
          }
        }
  
        // Process zip files
        const processZipFile = async (file, currentFeatures) => {
          const arrayBuffer = await file.arrayBuffer();
          const geojson = await shp(arrayBuffer);
  
          let parsedFeatures = [];
          if (Array.isArray(geojson)) {
            geojson.forEach(layer => {
              const feats = layer.type === 'FeatureCollection'
                ? layer.features
                : [layer];
              parsedFeatures = parsedFeatures.concat(feats);
            });
          } else {
            parsedFeatures = geojson.type === 'FeatureCollection'
              ? geojson.features
              : [geojson];
          }
  
          const validFeatures = processFeatures(parsedFeatures, currentFeatures.length);
          totalParsed += validFeatures.length;
          
          const boundaryFiltered = validFeatures
            .map(f => cropFeatureByBoundary(f, cityBoundary))
            .filter(f => f !== null);
          
          const cropped = validFeatures.length - boundaryFiltered.length;
          totalCropped += cropped;
          console.log(`Zip file ${file.name}: ${validFeatures.length} features, ${boundaryFiltered.length} within/cropped to boundary (${cropped} removed)`);
          
          return boundaryFiltered;
        };
  
        for (const file of zipFiles) {
          const processedFeatures = await processZipFile(file, newFeatures);
          newFeatures = newFeatures.concat(processedFeatures);
        }
  
        // Process GeoJSON files
        const processGeoJsonFile = async (file, currentFeatures) => {
          const text = await file.text();
          const geojson = JSON.parse(text);
  
          let parsedFeatures = geojson.type === 'FeatureCollection'
            ? geojson.features
            : [geojson];
  
          const validFeatures = processFeatures(parsedFeatures, currentFeatures.length);
          totalParsed += validFeatures.length;
          
          const boundaryFiltered = validFeatures
            .map(f => cropFeatureByBoundary(f, cityBoundary))
            .filter(f => f !== null);
          
          const cropped = validFeatures.length - boundaryFiltered.length;
          totalCropped += cropped;
          console.log(`GeoJSON file ${file.name}: ${validFeatures.length} features, ${boundaryFiltered.length} within/cropped to boundary (${cropped} removed)`);
          
          return boundaryFiltered;
        };
  
        for (const file of geojsonFiles) {
          const processedFeatures = await processGeoJsonFile(file, newFeatures);
          newFeatures = newFeatures.concat(processedFeatures);
        }
  
        // Append or replace based on mode
        if (newFeatures.length > 0) {
          const combined = appendMode ? [...features, ...newFeatures] : newFeatures;
          const unique = removeDuplicateFeatures(combined);
          console.log(`Combined total: ${unique.length} unique features (${combined.length - unique.length} duplicates removed, ${totalCropped} cropped/removed by boundary, mode: ${appendMode ? 'append' : 'replace'})`);
          setFeatures(unique);
          setStep(4);
          
          if (totalCropped > 0) {
            alert(`Loaded ${unique.length} features. ${totalCropped} features were outside the city boundary and were removed or cropped.`);
          }
        } else {
          alert('No valid features found in the uploaded files. Please ensure the files contain valid geographic data.');
        }
      }
    } catch (error) {
      console.error('Error processing files:', error);
      let errorMessage = 'Error processing files';
  
      if (error.message.includes('no layers found')) {
        errorMessage = 'No valid geographic data found in the files. Please ensure the files contain valid shapefile or GeoJSON data.';
      } else if (error.message.includes('must be a string')) {
        errorMessage = 'Invalid file format. For shapefiles, please upload a .zip file or select all components together.';
      } else {
        errorMessage = 'Error processing files: ' + error.message;
      }
  
      alert(errorMessage);
  
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } finally {
      setIsProcessing(false);
      // Clear file input to allow re-uploading the same file
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleSave = () => {
    const finalLayerName = isCustomLayer ? customLayerName : layerName;
    const finalLayerIcon = isCustomLayer ? customLayerIcon : layerIcon;
    
    const nameValidationError = validateLayerName(finalLayerName);
    if (nameValidationError) {
      setNameError(nameValidationError);
      return;
    }

    if (features.length === 0) {
      alert('Please add at least one feature before saving');
      return;
    }

    onSave({
      name: finalLayerName,
      icon: finalLayerIcon,
      domain: domain,
      features: features
    });
    console.log('Layer saved:', { name: finalLayerName, icon: finalLayerIcon, domain, features });
  };

  const handleClose = () => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
      console.log('Drawing map closed');
    }
    if (reviewMapInstanceRef.current) {
      reviewMapInstanceRef.current.remove();
      reviewMapInstanceRef.current = null;
      console.log('Review map closed');
    }
  
    setStep(1);
    setLayerName('');
    setLayerIcon('fas fa-map-marker-alt');
    setDataSource('upload');
    setUploadedFile(null);
    setFeatures([]);
    setEditingFeatureName(null);
    setFeatureNameInput('');
    setNameError('');
    setIsCustomLayer(false);
    setCustomLayerName('');
    setCustomLayerIcon('fas fa-map-marker-alt');
    setAppendMode(true);
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

          {editingFeatureName !== null && (
            <div className="feature-name-editor">
              <h4>Edit Feature Name</h4>
              <input
                type="text"
                value={featureNameInput}
                onChange={(e) => setFeatureNameInput(e.target.value)}
                placeholder="Enter feature name"
                autoFocus
              />
              <div className="form-actions">
                <button className="btn-secondary" onClick={() => {
                  setEditingFeatureName(null);
                  setFeatureNameInput('');
                }}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={updateFeatureName}>
                  Save
                </button>
              </div>
            </div>
          )}

          <div className="layer-form">
            {isLoadingExisting && (
              <div className="loading-indicator">
                <i className="fas fa-spinner fa-spin"></i>
                <p>Loading layer data...</p>
              </div>
            )}

            {!isLoadingExisting && step === 1 && (
              <>
                <div className="form-group">
                  <label>Select Layer *</label>
                  <select
                    value={isCustomLayer ? 'custom' : layerName}
                    onChange={handleLayerSelection}
                    disabled={!!editingLayer}
                  >
                    <option value="">Choose a layer...</option>
                    {predefinedLayers.map(layer => (
                      <option key={layer.name} value={layer.name}>
                        {layer.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                      </option>
                    ))}
                    <option value="custom">+ Add Custom Layer</option>
                  </select>
                  <small>Select a predefined layer or create a custom one</small>
                </div>

                {isCustomLayer && (
                  <>
                    <div className="form-group">
                      <label>Custom Layer Name *</label>
                      <input
                        type="text"
                        value={customLayerName}
                        onChange={handleLayerNameChange}
                        placeholder="e.g., custom_layer"
                        pattern="[a-z_]+"
                      />
                      <small>Use lowercase letters and underscores only</small>
                      {nameError && <small className="error">{nameError}</small>}
                    </div>

                    <div className="form-group">
                      <label>Icon</label>
                      <div className="icon-selector">
                        {availableIcons.map(icon => (
                          <button
                            key={icon}
                            className={`icon-option ${customLayerIcon === icon ? 'selected' : ''}`}
                            onClick={() => setCustomLayerIcon(icon)}
                            type="button"
                          >
                            <i className={icon}></i>
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {!isCustomLayer && layerName && (
                  <div className="form-group">
                    <label>Selected Layer Icon</label>
                    <div className="selected-icon-preview">
                      <i className={layerIcon} style={{ fontSize: '24px', color: domainColor }}></i>
                      <span>{layerName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</span>
                    </div>
                  </div>
                )}

                <div className="form-actions">
                  <button className="btn-secondary" onClick={handleClose}>
                    Cancel
                  </button>
                  <button
                    className="btn-primary"
                    onClick={() => setStep(2)}
                    disabled={isCustomLayer ? (!customLayerName || !!nameError) : !layerName}
                  >
                    Next <i className="fas fa-arrow-right"></i>
                  </button>
                </div>
              </>
            )}

            {!isLoadingExisting && step === 2 && (
              <>
                <div className="data-source-selection">
                  <button
                    className={`source-option ${dataSource === 'upload' ? 'selected' : ''}`}
                    onClick={() => setDataSource('upload')}
                  >
                    <i className="fas fa-upload"></i>
                    <h4>Upload File</h4>
                    <p>Upload GeoJSON, Shapefile, CSV, or Parquet</p>
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

            {!isLoadingExisting && step === 3 && (
              <>
                {dataSource === 'upload' ? (
                  <div className="upload-section">
                    {/* Add append/replace toggle */}
                    <div className="form-group">
                      <label className="toggle-label">
                        <input
                          type="checkbox"
                          checked={appendMode}
                          onChange={(e) => setAppendMode(e.target.checked)}
                        />
                        <span style={{ marginLeft: '8px' }}>
                          {appendMode ? 'Append to existing features' : 'Replace existing features'}
                        </span>
                      </label>
                      <small>
                        {appendMode 
                          ? 'New features will be added to existing ones (duplicates removed)' 
                          : 'New features will replace all existing features'}
                      </small>
                    </div>
                    
                    <div className="upload-area" onClick={() => fileInputRef.current?.click()}>
                      <i className="fas fa-cloud-upload-alt"></i>
                      <h4>Click to upload or drag and drop</h4>
                      <p>GeoJSON (.geojson, .json), Shapefile (.zip, .shp), CSV (.csv), or Parquet (.parquet)</p>
                      {uploadedFile && <p className="uploaded-file">📁 {uploadedFile.name}</p>}
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".geojson,.json,.zip,.shp,.dbf,.shx,.prj,.csv,.parquet"
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
                    <div ref={mapRef} className="map-container"></div>
                    <div className="draw-instructions">
                      <p><i className="fas fa-info-circle"></i> Use the drawing tools to add features. Click markers to edit names. Features: {features.length}</p>
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

            {!isLoadingExisting && step === 4 && (
              <>
                <div className="review-section">
                  <div className="review-summary">
                    <i className="fas fa-check-circle"></i>
                    <h4>File processed successfully!</h4>
                    <p>{features.length} feature{features.length !== 1 ? 's' : ''} loaded</p>
                  </div>

                  {/* Add upload button for adding more features */}
                  <div className="append-upload-section">
                    <button 
                      className="btn-secondary"
                      onClick={() => {
                        // Go back to upload step, keeping existing features
                        setDataSource('upload');
                        setAppendMode(true); // Default to append mode
                        setStep(3);
                      }}
                      disabled={isProcessing}
                    >
                      <i className="fas fa-plus"></i> Add More Features
                    </button>
                  </div>

                  <div className="review-map-container">
                    <div ref={reviewMapRef} className="map-container"></div>
                    <div className="draw-instructions">
                      <p><i className="fas fa-info-circle"></i> Review and edit your features using the map tools. Click on markers to edit feature names. Current features: {features.length}</p>
                    </div>
                  </div>
                </div>

                <div className="form-actions">
                  <button className="btn-secondary" onClick={() => {
                    if (reviewMapInstanceRef.current) {
                      reviewMapInstanceRef.current.remove();
                      reviewMapInstanceRef.current = null;
                      console.log('Review map closed on back navigation');
                    }
                    setDataSource('upload');
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
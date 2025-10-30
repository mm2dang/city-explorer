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

const layerDefs = {
  mobility: [
    { tags: { highway: true }, name: 'roads', icon: 'fas fa-road' },
    { tags: { highway: ['footway'] }, name: 'sidewalks', icon: 'fas fa-walking' },
    { tags: { amenity: ['parking', 'parking_space'] }, name: 'parking', icon: 'fas fa-parking' },
    { tags: { highway: ['bus_stop'] }, name: 'transit_stops', icon: 'fas fa-bus' },
    { tags: { railway: ['subway'] }, name: 'subways', icon: 'fas fa-subway' },
    { tags: { railway: ['rail'] }, name: 'railways', icon: 'fas fa-train' },
    { tags: { aeroway: ['runway'] }, name: 'airports', icon: 'fas fa-plane' },
    { tags: { amenity: ['bicycle_parking'] }, name: 'bicycle_parking', icon: 'fas fa-bicycle' },
  ],
  governance: [
    { tags: { amenity: ['police'] }, name: 'police', icon: 'fas fa-shield-alt' },
    { tags: { office: ['government'] }, name: 'government_offices', icon: 'fas fa-landmark' },
    { tags: { amenity: ['fire_station'] }, name: 'fire_stations', icon: 'fas fa-fire-extinguisher' },
  ],
  health: [
    { tags: { amenity: ['hospital'] }, name: 'hospitals', icon: 'fas fa-hospital' },
    { tags: { amenity: ['doctors'] }, name: 'doctor_offices', icon: 'fas fa-user-md' },
    { tags: { amenity: ['dentist'] }, name: 'dentists', icon: 'fas fa-tooth' },
    { tags: { amenity: ['clinic'] }, name: 'clinics', icon: 'fas fa-clinic-medical' },
    { tags: { amenity: ['pharmacy'] }, name: 'pharmacies', icon: 'fas fa-pills' },
    { tags: { healthcare: ['alternative'] }, name: 'acupuncture', icon: 'fas fa-hand-holding-heart' },
  ],
  economy: [
    { tags: { building: ['industrial'] }, name: 'factories', icon: 'fas fa-industry' },
    { tags: { amenity: ['bank'] }, name: 'banks', icon: 'fas fa-university' },
    { tags: { shop: true }, name: 'shops', icon: 'fas fa-store' },
    { tags: { amenity: ['restaurant'] }, name: 'restaurants', icon: 'fas fa-utensils' },
  ],
  environment: [
    { tags: { leisure: ['park'] }, name: 'parks', icon: 'fas fa-tree' },
    { tags: { landuse: ['greenfield'] }, name: 'open_green_spaces', icon: 'fas fa-leaf' },
    { tags: { natural: true }, name: 'nature', icon: 'fas fa-mountain' },
    { tags: { waterway: true }, name: 'waterways', icon: 'fas fa-water' },
    { tags: { natural: ['water'] }, name: 'lakes', icon: 'fas fa-tint' },
  ],
  culture: [
    { tags: { tourism: ['attraction'] }, name: 'tourist_attractions', icon: 'fas fa-camera' },
    { tags: { tourism: ['theme_park'] }, name: 'theme_parks', icon: 'fas fa-ticket' },
    { tags: { sport: true }, name: 'gyms', icon: 'fas fa-dumbbell' },
    { tags: { amenity: ['theatre'] }, name: 'theatres', icon: 'fas fa-theater-masks' },
    { tags: { leisure: ['stadium'] }, name: 'stadiums', icon: 'fas fa-futbol' },
    { tags: { amenity: ['place_of_worship'] }, name: 'places_of_worship', icon: 'fas fa-pray' },
  ],
  education: [
    { tags: { amenity: ['school'] }, name: 'schools', icon: 'fas fa-school' },
    { tags: { amenity: ['university'] }, name: 'universities', icon: 'fas fa-university' },
    { tags: { amenity: ['college'] }, name: 'colleges', icon: 'fas fa-graduation-cap' },
    { tags: { amenity: ['library'] }, name: 'libraries', icon: 'fas fa-book' },
  ],
  housing: [
    { tags: { building: ['house'] }, name: 'houses', icon: 'fas fa-home' },
    { tags: { building: ['apartments'] }, name: 'apartments', icon: 'fas fa-building' },
  ],
  social: [
    { tags: { amenity: ['bar'] }, name: 'bars', icon: 'fas fa-wine-glass-alt' },
    { tags: { amenity: ['cafe'] }, name: 'cafes', icon: 'fas fa-coffee' },
    { tags: { leisure: true }, name: 'leisure_facilities', icon: 'fas fa-dice' },
  ],
};

const LayerModal = ({
  isOpen,
  onClose,
  editingLayer,
  domain,
  domainColor,
  existingLayers,
  onSave,
  cityBoundary,
  cityName,
  domainColors,
  availableLayersByDomain,
  mapView = 'street',
  getAllFeatures, 
  selectedCity
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
  const [selectedDomain, setSelectedDomain] = useState(domain || '');
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const drawnItemsRef = useRef(null);
  const centroidGroupRef = useRef(null);
  const fileInputRef = useRef(null);
  const reviewMapRef = useRef(null);
  const reviewMapInstanceRef = useRef(null);
  const reviewDrawnItemsRef = useRef(null);
  const reviewCentroidGroupRef = useRef(null);
  const [osmTags, setOsmTags] = useState([{ key: '', value: '' }]);
  const [isFetchingOSM, setIsFetchingOSM] = useState(false);
  const [allCityFeatures, setAllCityFeatures] = useState([]);

  useEffect(() => {
    console.log('LayerModal received mapView prop:', mapView);
  }, [mapView]);

  useEffect(() => {
    const loadAllFeatures = async () => {
      if (getAllFeatures && selectedCity) {
        try {
          const features = await getAllFeatures();
          setAllCityFeatures(features);
          console.log(`Loaded ${features.length} total features across ALL domains for duplicate checking`);
        } catch (error) {
          console.error('Error loading all features:', error);
          setAllCityFeatures([]);
        }
      } else {
        setAllCityFeatures([]);
      }
    };
    
    loadAllFeatures();
  }, [getAllFeatures, selectedCity]);

  const predefinedLayers = useMemo(() => {
    const allLayers = layerDefs[selectedDomain] || [];
    const currentExistingLayers = selectedDomain && domainColors
      ? (availableLayersByDomain?.[selectedDomain] || [])
      : existingLayers;
    
    return allLayers.filter(layer => {
      const layerExists = currentExistingLayers.some(existing => 
        existing.name === layer.name && (!editingLayer || editingLayer.name !== layer.name)
      );
      return !layerExists;
    });
  }, [selectedDomain, existingLayers, editingLayer, domainColors, availableLayersByDomain]);

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

  const domainIcons = {
    mobility: 'fas fa-car',
    governance: 'fas fa-landmark',
    health: 'fas fa-heartbeat',
    economy: 'fas fa-chart-line',
    environment: 'fas fa-leaf',
    culture: 'fas fa-palette',
    education: 'fas fa-graduation-cap',
    housing: 'fas fa-home',
    social: 'fas fa-users',
  };

  const formatDomainName = (domainName) => {
    return domainName.charAt(0).toUpperCase() + domainName.slice(1);
  };

  const currentDomainColor = useMemo(() => {
    return selectedDomain && domainColors ? domainColors[selectedDomain] : (domainColor || '#666666');
  }, [selectedDomain, domainColors, domainColor]);

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

  const cropFeatureByBoundary = useCallback((feature, boundaryGeojson) => {
    if (!boundaryGeojson) return feature;
    try {
      const boundary = typeof boundaryGeojson === 'string'
        ? JSON.parse(boundaryGeojson)
        : boundaryGeojson;
      const boundaryFeature = {
        type: 'Feature',
        geometry: boundary.geometry || boundary,
        properties: {}
      };
      const turfFeature = {
        type: 'Feature',
        geometry: feature.geometry,
        properties: feature.properties || {}
      };
      const intersects = turf.booleanIntersects(turfFeature, boundaryFeature);
      if (!intersects) {
        return null;
      }
      if (feature.geometry.type === 'Point') {
        const isWithin = turf.booleanPointInPolygon(turfFeature, boundaryFeature);
        return isWithin ? feature : null;
      } else if (feature.geometry.type === 'LineString' || feature.geometry.type === 'MultiLineString') {
        return feature;
      } else if (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon') {
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
      return feature;
    }
  }, []);

  const removeDuplicateFeatures = useCallback((newFeatures) => {
    const uniqueFeatures = [];
    const seenCoordinates = new Set();
    
    console.log(`Checking ${newFeatures.length} new features against ${allCityFeatures.length} existing features in domain`);
    
    // Helper function to get coordinate key from a feature
    const getCoordinateKey = (feature) => {
      if (!feature.geometry || !feature.geometry.coordinates) {
        return null;
      }
      
      let lat, lon;
      
      if (feature.geometry.type === 'Point') {
        [lon, lat] = feature.geometry.coordinates;
      } else if (feature.geometry.type === 'LineString' && feature.geometry.coordinates.length > 0) {
        [lon, lat] = feature.geometry.coordinates[0];
      } else if (feature.geometry.type === 'Polygon' && feature.geometry.coordinates.length > 0 && feature.geometry.coordinates[0].length > 0) {
        [lon, lat] = feature.geometry.coordinates[0][0];
      } else if (feature.geometry.type === 'MultiLineString' && feature.geometry.coordinates.length > 0 && feature.geometry.coordinates[0].length > 0) {
        [lon, lat] = feature.geometry.coordinates[0][0];
      } else if (feature.geometry.type === 'MultiPolygon' && feature.geometry.coordinates.length > 0 && feature.geometry.coordinates[0].length > 0 && feature.geometry.coordinates[0][0].length > 0) {
        [lon, lat] = feature.geometry.coordinates[0][0][0];
      } else {
        // Try to compute centroid for other geometry types
        try {
          const turfFeature = { type: 'Feature', geometry: feature.geometry, properties: {} };
          const centroid = turf.centroid(turfFeature);
          [lon, lat] = centroid.geometry.coordinates;
        } catch (error) {
          return null;
        }
      }
      
      if (lon === undefined || lat === undefined || isNaN(lon) || isNaN(lat)) {
        return null;
      }
      
      // Create key with rounded coordinates (6 decimal places = ~0.1 meter precision)
      return `${lat.toFixed(6)},${lon.toFixed(6)}`;
    };
    
    // Add all existing domain features' coordinates to the seen set
    allCityFeatures.forEach(feature => {
      if (!editingLayer || feature.properties?.layer_name !== editingLayer.name) {
        const coordKey = getCoordinateKey(feature);
        if (coordKey) {
          seenCoordinates.add(coordKey);
        }
      }
    });
    
    console.log(`Added ${seenCoordinates.size} existing feature coordinates to duplicate check`);
    
    // Then process new features
    let duplicatesFound = 0;
    
    newFeatures.forEach((newFeature, index) => {
      const coordKey = getCoordinateKey(newFeature);
      
      if (!coordKey) {
        console.warn(`Could not extract coordinates from feature at index ${index}`);
        uniqueFeatures.push(newFeature);
        return;
      }
      
      // Check if this coordinate already exists
      if (seenCoordinates.has(coordKey)) {
        duplicatesFound++;
        console.log(`Duplicate found at index ${index}: coordinate ${coordKey} already exists`);
        return;
      }
      
      // Add to unique features and mark coordinate as seen
      seenCoordinates.add(coordKey);
      uniqueFeatures.push(newFeature);
    });
    
    if (duplicatesFound > 0) {
      console.log(`Removed ${duplicatesFound} duplicate features based on lat/lon coordinates`);
      
      alert(
        `${duplicatesFound} duplicate feature${duplicatesFound > 1 ? 's were' : ' was'} removed.\n` +
        `These features have the same latitude/longitude as features already in the ${selectedDomain} domain.`
      );
    }
    
    console.log(`Final result: ${uniqueFeatures.length} unique features out of ${newFeatures.length} total`);
    return uniqueFeatures;
  }, [allCityFeatures, editingLayer, selectedDomain]);

  const createPopupContent = useCallback((feature, index, finalLayerName, currentDomain, includeType = false) => {
    const featureName = feature.properties?.name || feature.properties?.feature_name || `Feature ${index + 1}`;
    return `
      <div style="font-family: Inter, sans-serif;">
        <h4 style="margin: 0 0 8px 0; color: #1a202c; font-size: 14px;">
          ${featureName}
        </h4>
        <p style="margin: 0; color: #64748b; font-size: 12px;">
          <strong>Layer:</strong> ${finalLayerName}<br>
          <strong>Domain:</strong> ${currentDomain}${includeType ? `<br><strong>Type:</strong> ${feature.geometry.type}` : ''}
        </p>
        <button class="edit-feature-btn" data-feature-index="${index}"
          style="margin-top: 8px; padding: 4px 8px; background: #0891b2; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">
          <i class="fas fa-edit"></i> Edit Name
        </button>
      </div>
    `;
  }, []);

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
          domain_name: selectedDomain
        }
      };
      if (validateFeature(newFeature, featureIndex)) {
        newFeatures.push(newFeature);
        console.log(`Updated feature at index ${featureIndex}:`, newFeature);
      }
    });
    setFeatures(newFeatures);
    console.log('Updated features from map:', newFeatures);
  }, [layerName, customLayerName, isCustomLayer, selectedDomain, features]);

  const updateReviewFeaturesFromMap = useCallback(() => {
    updateFeaturesFromMap(reviewDrawnItemsRef.current);
  }, [updateFeaturesFromMap]);

  const validateLayerName = useCallback((name) => {
    if (!name) {
      return 'Layer name is required';
    }
    if (!name.match(/^[a-z_]+$/)) {
      return 'Layer name must contain only lowercase letters and underscores';
    }
    const currentExistingLayers = selectedDomain && domainColors
      ? (availableLayersByDomain?.[selectedDomain] || [])
      : existingLayers;
    
    const layerExists = currentExistingLayers.some(layer => 
      layer.name === name && (!editingLayer || editingLayer.name !== name)
    );
    
    if (layerExists) {
      return `A layer named "${name}" already exists in this domain`;
    }
    return '';
  }, [selectedDomain, existingLayers, editingLayer, domainColors, availableLayersByDomain]);
  
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
      setNameError('');
    } else {
      const currentExistingLayers = selectedDomain && domainColors
        ? (availableLayersByDomain?.[selectedDomain] || [])
        : existingLayers;
      
      const layerExists = currentExistingLayers.some(layer => 
        layer.name === value && (!editingLayer || editingLayer.name !== value)
      );
      
      if (layerExists) {
        alert(`The layer "${value.replace(/_/g, ' ')}" already exists in this domain. Please choose a different layer or create a custom one.`);
        setLayerName('');
        setIsCustomLayer(false);
        return;
      }
      
      setIsCustomLayer(false);
      const selectedLayer = predefinedLayers.find(l => l.name === value);
      if (selectedLayer) {
        setLayerName(selectedLayer.name);
        setLayerIcon(selectedLayer.icon);
        setNameError('');
      }
    }
  };

  useEffect(() => {
    // Prefill OSM tags for predefined layers
    if (!isCustomLayer && layerName && selectedDomain) {
      const domainLayers = layerDefs[selectedDomain] || [];
      const layerDef = domainLayers.find(l => l.name === layerName);
      
      if (layerDef && layerDef.tags) {
        console.log('Found layer definition with tags:', layerDef);
        // Convert tags object to array format
        const tagArray = [];
        Object.entries(layerDef.tags).forEach(([key, value]) => {
          if (value === true) {
            tagArray.push({ key, value: '*' });
          } else if (Array.isArray(value)) {
            value.forEach(val => {
              tagArray.push({ key, value: val });
            });
          } else {
            tagArray.push({ key, value: String(value) });
          }
        });
        
        console.log('Setting OSM tags:', tagArray);
        if (tagArray.length > 0) {
          setOsmTags(tagArray);
        }
      } else {
        console.log('No layer definition found for:', layerName);
      }
    } else if (isCustomLayer) {
      // Reset to empty tags for custom layers
      setOsmTags([{ key: '', value: '' }]);
    }
  }, [layerName, isCustomLayer, selectedDomain]);

  useEffect(() => {
    const loadExistingLayerData = async () => {
      if (!cityName) {
        console.warn('cityName is undefined');
        return;
      }
      if (editingLayer) {
        setIsLoadingExisting(true);
        setSelectedDomain(domain || '');
        setLayerName(editingLayer.name);
        setLayerIcon(editingLayer.icon);
        setIsCustomLayer(false);
        const currentPredefinedLayers = domain ? (layerDefs[domain] || []) : [];
        const isPredefined = currentPredefinedLayers.some(l => l.name === editingLayer.name);
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
          setStep(2);
          setDataSource('draw');
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
        setSelectedDomain(domain || '');
        setNameError('');
      }
    };
    if (isOpen) {
      loadExistingLayerData();
    }
  }, [editingLayer, isOpen, domain, cityName]);

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
      const tileLayerUrl = mapView === 'satellite'
        ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
        : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
      const tileLayerAttribution = mapView === 'satellite'
        ? 'Tiles © Esri'
        : '© OpenStreetMap contributors';
      L.tileLayer(tileLayerUrl, {
        attribution: tileLayerAttribution
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
                background-color: ${currentDomainColor};
                width: 30px;
                height: 30px;
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
      features.forEach((feature, index) => {
        if (validateFeature(feature, index)) {
          if (feature.geometry.type === 'Point') {
            const [lon, lat] = feature.geometry.coordinates;
            const marker = L.marker([lat, lon], {
              icon: L.divIcon({
                className: 'custom-marker-icon',
                html: `<div style="
                  background-color: ${currentDomainColor};
                  width: 30px;
                  height: 30px;
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
            const popupContent = createPopupContent(feature, index, finalLayerName, selectedDomain, false);
            marker.bindPopup(popupContent, {
              closeButton: true,
              className: 'feature-marker-popup',
              maxWidth: 400
            });
            drawnItems.addLayer(marker);
            console.log(`Drawing map: Added point feature at index ${index}:`, feature);
          } else {
            const geoJsonLayer = L.geoJSON(feature.geometry, {
              style: {
                color: currentDomainColor,
                weight: 3,
                opacity: 0.9,
                fillColor: currentDomainColor,
                fillOpacity: 0.3
              }
            });
            const popupContent = createPopupContent(feature, index, finalLayerName, selectedDomain, true);
            geoJsonLayer.bindPopup(popupContent, {
              closeButton: true,
              className: 'feature-marker-popup'
            });
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
                      background-color: ${currentDomainColor};
                      width: 30px;
                      height: 30px;
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
                const centroidPopupContent = createPopupContent(feature, index, finalLayerName, selectedDomain, true);
                centroidMarker.bindPopup(centroidPopupContent, {
                  closeButton: true,
                  className: 'feature-marker-popup'
                });
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
          editButton.addEventListener('click', (evt) => {
            evt.stopPropagation();
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
            domain_name: selectedDomain
          }
        };
        const croppedFeature = cropFeatureByBoundary(newFeature, cityBoundary);
        if (croppedFeature && validateFeature(croppedFeature, featureIndex)) {
          drawnItems.addLayer(layer);
          setFeatures(prev => [...prev, croppedFeature]);
          console.log('Feature created in drawing map and cropped:', croppedFeature);
          
          const popupContent = createPopupContent(croppedFeature, featureIndex, finalLayerName, selectedDomain, croppedFeature.geometry.type !== 'Point');
          layer.bindPopup(popupContent, {
            closeButton: true,
            className: 'feature-marker-popup'
          });
          
          setTimeout(() => {
            setEditingFeatureName(featureIndex);
            setFeatureNameInput(`Feature ${featureIndex + 1}`);
          }, 100);
        } else {
          console.warn('Feature is outside city boundary in drawing map:', newFeature);
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
  }, [step, dataSource, cityBoundary, currentDomainColor, layerIcon, layerName, selectedDomain, isLoadingExisting, features, updateFeaturesFromMap, isCustomLayer, customLayerIcon, customLayerName, cropFeatureByBoundary, createPopupContent, mapView]);

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
      const tileLayerUrl = mapView === 'satellite'
        ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
        : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
      const tileLayerAttribution = mapView === 'satellite'
        ? 'Tiles © Esri'
        : '© OpenStreetMap contributors';
      L.tileLayer(tileLayerUrl, {
        attribution: tileLayerAttribution
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
                background-color: ${currentDomainColor};
                width: 30px;
                height: 30px;
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
      features.forEach((feature, index) => {
        if (validateFeature(feature, index)) {
          if (feature.geometry.type === 'Point') {
            const [lon, lat] = feature.geometry.coordinates;
            const marker = L.marker([lat, lon], {
              icon: L.divIcon({
                className: 'custom-marker-icon',
                html: `<div style="
                  background-color: ${currentDomainColor};
                  width: 30px;
                  height: 30px;
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
            const popupContent = createPopupContent(feature, index, finalLayerName, selectedDomain, false);
            marker.bindPopup(popupContent, {
              closeButton: true,
              className: 'feature-marker-popup',
              maxWidth: 400
            });
            drawnItems.addLayer(marker);
            console.log(`Review map: Added point feature at index ${index}:`, feature);
          } else {
            const geoJsonLayer = L.geoJSON(feature.geometry, {
              style: {
                color: currentDomainColor,
                weight: 3,
                opacity: 0.9,
                fillColor: currentDomainColor,
                fillOpacity: 0.3
              }
            });
            const popupContent = createPopupContent(feature, index, finalLayerName, selectedDomain, true);
            geoJsonLayer.bindPopup(popupContent, {
              closeButton: true,
              className: 'feature-marker-popup'
            });
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
                      background-color: ${currentDomainColor};
                      width: 30px;
                      height: 30px;
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
                const centroidPopupContent = createPopupContent(feature, index, finalLayerName, selectedDomain, true);
                centroidMarker.bindPopup(centroidPopupContent, {
                  closeButton: true,
                  className: 'feature-marker-popup'
                });
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
          editButton.addEventListener('click', (evt) => {
            evt.stopPropagation();
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
            domain_name: selectedDomain
          }
        };
        const croppedFeature = cropFeatureByBoundary(newFeature, cityBoundary);
        if (croppedFeature && validateFeature(croppedFeature, featureIndex)) {
          drawnItems.addLayer(layer);
          setFeatures(prev => [...prev, croppedFeature]);
          console.log('Feature created in review map and cropped:', croppedFeature);
          
          const popupContent = createPopupContent(croppedFeature, featureIndex, finalLayerName, selectedDomain, croppedFeature.geometry.type !== 'Point');
          layer.bindPopup(popupContent, {
            closeButton: true,
            className: 'feature-marker-popup'
          });
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
  }, [step, cityBoundary, currentDomainColor, layerIcon, layerName, selectedDomain, features, updateReviewFeaturesFromMap, isCustomLayer, customLayerIcon, customLayerName, cropFeatureByBoundary, mapView, createPopupContent]);

  useEffect(() => {
    if (step === 4 && reviewMapInstanceRef.current && features.length > 0) {
      const finalLayerName = isCustomLayer ? customLayerName : layerName;
      const finalLayerIcon = isCustomLayer ? customLayerIcon : layerIcon;
      if (reviewDrawnItemsRef.current) {
        reviewDrawnItemsRef.current.clearLayers();
      }
      if (reviewCentroidGroupRef.current) {
        reviewCentroidGroupRef.current.clearLayers();
      }
      features.forEach((feature, index) => {
        if (validateFeature(feature, index)) {
          if (feature.geometry.type === 'Point') {
            const [lon, lat] = feature.geometry.coordinates;
            const marker = L.marker([lat, lon], {
              icon: L.divIcon({
                className: 'custom-marker-icon',
                html: `<div style="
                  background-color: ${currentDomainColor};
                  width: 30px;
                  height: 30px;
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
            const popupContent = createPopupContent(feature, index, finalLayerName, selectedDomain, false);
            marker.bindPopup(popupContent, {
              closeButton: true,
              className: 'feature-marker-popup',
              maxWidth: 400
            });
            reviewDrawnItemsRef.current.addLayer(marker);
          } else {
            const geoJsonLayer = L.geoJSON(feature.geometry, {
              style: {
                color: currentDomainColor,
                weight: 3,
                opacity: 0.9,
                fillColor: currentDomainColor,
                fillOpacity: 0.3
              }
            });
            const popupContent = createPopupContent(feature, index, finalLayerName, selectedDomain, true);
            geoJsonLayer.bindPopup(popupContent, {
              closeButton: true,
              className: 'feature-marker-popup'
            });
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
                      background-color: ${currentDomainColor};
                      width: 30px;
                      height: 30px;
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
                const centroidPopupContent = createPopupContent(feature, index, finalLayerName, selectedDomain, true);
                centroidMarker.bindPopup(centroidPopupContent, {
                  closeButton: true,
                  className: 'feature-marker-popup'
                });
                reviewCentroidGroupRef.current.addLayer(centroidMarker);
              }
            } catch (error) {
              console.error(`Error adding centroid at index ${index}:`, error);
            }
          }
        }
      });
      if (reviewDrawnItemsRef.current.getLayers().length > 0) {
        const bounds = reviewDrawnItemsRef.current.getBounds();
        reviewMapInstanceRef.current.fitBounds(bounds, { padding: [50, 50] });
      }
      console.log('Review map refreshed with updated features:', features.length);
    }
  }, [features, step, currentDomainColor, layerIcon, layerName, selectedDomain, isCustomLayer, customLayerIcon, customLayerName, createPopupContent]);

  // Update tile layer when mapView changes (Drawing Map)
useEffect(() => {
  console.log('Drawing map mapView effect check:', { 
    hasMap: !!mapInstanceRef.current, 
    step, 
    dataSource, 
    mapView,
    shouldRun: mapInstanceRef.current && step === 3 && dataSource === 'draw'
  });
  
  if (!mapInstanceRef.current || step !== 3 || dataSource !== 'draw') {
    return;
  }

  console.log('Drawing map mapView effect RUNNING - switching to:', mapView);

  // Find and remove all existing tile layers
  const tileLayers = [];
  mapInstanceRef.current.eachLayer(layer => {
    if (layer instanceof L.TileLayer) {
      tileLayers.push(layer);
    }
  });

  console.log(`Found ${tileLayers.length} tile layers to remove`);
  
  tileLayers.forEach(layer => {
    mapInstanceRef.current.removeLayer(layer);
  });

  // Create and add new tile layer
  let newTileLayer;
  if (mapView === 'satellite') {
    console.log('Creating satellite tile layer');
    newTileLayer = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: 'Tiles © Esri'
      }
    );
  } else {
    console.log('Creating street tile layer');
    newTileLayer = L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        attribution: '© OpenStreetMap contributors'
      }
    );
  }

  newTileLayer.addTo(mapInstanceRef.current);
  newTileLayer.bringToBack();
  
  // Force map to repaint
  setTimeout(() => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.invalidateSize();
    }
  }, 100);
  
  console.log('Drawing map tile layer switched to:', mapView);
}, [mapView, step, dataSource]);

// Update tile layer when mapView changes (Review Map)
useEffect(() => {
  console.log('Review map mapView effect check:', { 
    hasMap: !!reviewMapInstanceRef.current, 
    step, 
    mapView,
    shouldRun: reviewMapInstanceRef.current && step === 4
  });
  
  if (!reviewMapInstanceRef.current || step !== 4) {
    return;
  }

  console.log('Review map mapView effect RUNNING - switching to:', mapView);

  // Find and remove all existing tile layers
  const tileLayers = [];
  reviewMapInstanceRef.current.eachLayer(layer => {
    if (layer instanceof L.TileLayer) {
      tileLayers.push(layer);
    }
  });

  console.log(`Found ${tileLayers.length} tile layers to remove`);
  
  tileLayers.forEach(layer => {
    reviewMapInstanceRef.current.removeLayer(layer);
  });

  // Create and add new tile layer
  let newTileLayer;
  if (mapView === 'satellite') {
    console.log('Creating satellite tile layer');
    newTileLayer = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: 'Tiles © Esri'
      }
    );
  } else {
    console.log('Creating street tile layer');
    newTileLayer = L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        attribution: '© OpenStreetMap contributors'
      }
    );
  }

  newTileLayer.addTo(reviewMapInstanceRef.current);
  newTileLayer.bringToBack();
  
  // Force map to repaint
  setTimeout(() => {
    if (reviewMapInstanceRef.current) {
      reviewMapInstanceRef.current.invalidateSize();
    }
  }, 100);
  
  console.log('Review map tile layer switched to:', mapView);
}, [mapView, step]);

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
            const feature = updatedFeatures[featureIndex];
            const includeType = feature.geometry.type !== 'Point';
            const popupContent = createPopupContent(feature, featureIndex, finalLayerName, selectedDomain, includeType);
            layer.unbindPopup();
            layer.bindPopup(popupContent, {
              closeButton: true,
              className: 'feature-marker-popup'
            });
          }
        });
      }
      if (centroidGroup) {
        centroidGroup.eachLayer(layer => {
          const featureIndex = Array.from(centroidGroup.getLayers()).indexOf(layer);
          if (featureIndex >= 0 && updatedFeatures[featureIndex]) {
            const feature = updatedFeatures[featureIndex];
            const popupContent = createPopupContent(feature, featureIndex, finalLayerName, selectedDomain, true);
            layer.unbindPopup();
            layer.bindPopup(popupContent, {
              closeButton: true,
              className: 'feature-marker-popup'
            });
          }
        });
      }
    };
    refreshPopups(drawnItemsRef.current, centroidGroupRef.current);
    refreshPopups(reviewDrawnItemsRef.current, reviewCentroidGroupRef.current);
    console.log('Feature name updated:', updatedFeatures[editingFeatureName]);
  };

  const handleAddOsmTag = () => {
    setOsmTags([...osmTags, { key: '', value: '' }]);
  };
  
  const handleRemoveOsmTag = (index) => {
    if (osmTags.length > 1) {
      setOsmTags(osmTags.filter((_, i) => i !== index));
    }
  };
  
  const handleOsmTagChange = (index, field, value) => {
    const newTags = [...osmTags];
    newTags[index][field] = value;
    setOsmTags(newTags);
  };

  const handleFetchFromOSM = async () => {
    if (!cityBoundary) {
      alert('City boundary is required to fetch from OSM');
      return;
    }
  
    // Validate tags
    const validTags = osmTags.filter(tag => tag.key.trim() !== '');
    if (validTags.length === 0) {
      alert('Please add at least one OSM tag');
      return;
    }
  
    setIsFetchingOSM(true);
    const finalLayerName = isCustomLayer ? customLayerName : layerName;
  
    try {
      // Parse boundary
      let boundaryGeojson;
      if (typeof cityBoundary === 'string') {
        boundaryGeojson = JSON.parse(cityBoundary);
      } else {
        boundaryGeojson = cityBoundary;
      }
  
      // Get bounding box
      const coords = boundaryGeojson.type === 'Polygon' 
        ? boundaryGeojson.coordinates[0]
        : boundaryGeojson.coordinates[0][0];
      
      const lons = coords.map(([lon]) => lon);
      const lats = coords.map(([, lat]) => lat);
      const bbox = `${Math.min(...lats)},${Math.min(...lons)},${Math.max(...lats)},${Math.max(...lons)}`;
  
      // Build Overpass query
      let tagQuery = '';
      validTags.forEach(tag => {
        if (tag.value === '*') {
          tagQuery += `["${tag.key}"]`;
        } else {
          tagQuery += `["${tag.key}"="${tag.value}"]`;
        }
      });
  
      const query = `
        [out:json][timeout:1000];
        (
          nwr${tagQuery}(${bbox});
        );
        out geom;
      `;
  
      console.log('Fetching from Overpass API with query:', query);
  
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
      });
  
      if (!response.ok) {
        throw new Error(`Overpass API error: ${response.statusText}`);
      }
  
      const data = await response.json();
      console.log('Received OSM data:', data);
  
      if (!data.elements || data.elements.length === 0) {
        alert('No features found with these tags in the city boundary');
        return;
      }
  
      // Process OSM elements to GeoJSON features
      const newFeatures = [];
      const boundaryFeature = {
        type: 'Feature',
        geometry: boundaryGeojson.geometry || boundaryGeojson,
        properties: {}
      };
  
      for (const element of data.elements) {
        try {
          let geometry = null;
          
          if (element.type === 'node' && element.lon !== undefined && element.lat !== undefined) {
            geometry = {
              type: 'Point',
              coordinates: [parseFloat(element.lon), parseFloat(element.lat)]
            };
          } else if (element.type === 'way' && element.geometry) {
            const coords = element.geometry.map(g => [g.lon, g.lat]);
            
            if (coords.length >= 2) {
              const isClosed = coords.length >= 4 && 
                Math.abs(coords[0][0] - coords[coords.length-1][0]) < 0.0001 && 
                Math.abs(coords[0][1] - coords[coords.length-1][1]) < 0.0001;
              
              if (isClosed) {
                geometry = { type: 'Polygon', coordinates: [coords] };
              } else {
                geometry = { type: 'LineString', coordinates: coords };
              }
            }
          } else if (element.type === 'relation' && element.geometry) {
            // Use first coordinate as point
            const coord = element.geometry.find(g => g.lon !== undefined && g.lat !== undefined);
            if (coord) {
              geometry = {
                type: 'Point',
                coordinates: [parseFloat(coord.lon), parseFloat(coord.lat)]
              };
            }
          }
  
          if (!geometry) continue;
  
          // Check if within boundary
          const feature = { type: 'Feature', geometry, properties: {} };
          let isInside = false;
          
          try {
            if (geometry.type === 'Point') {
              isInside = turf.booleanPointInPolygon(feature, boundaryFeature);
            } else {
              isInside = turf.booleanIntersects(feature, boundaryFeature);
            }
          } catch (error) {
            console.warn('Error checking intersection:', error);
            continue;
          }
  
          if (!isInside) continue;
  
          // Crop to boundary if needed
          const croppedFeature = cropFeatureByBoundary(feature, cityBoundary);
          if (!croppedFeature) continue;
  
          // Extract feature name
          const featureName = element.tags?.name || 
                             element.tags?.brand || 
                             element.tags?.operator || 
                             element.tags?.ref || 
                             'Unnamed Feature';
  
          newFeatures.push({
            type: 'Feature',
            geometry: croppedFeature.geometry,
            properties: {
              name: featureName,
              feature_name: featureName,
              layer_name: finalLayerName,
              domain_name: selectedDomain,
              ...element.tags
            }
          });
        } catch (error) {
          console.warn('Error processing OSM element:', error);
        }
      }
  
      if (newFeatures.length === 0) {
        alert('No features found within the city boundary');
        return;
      }
  
      console.log(`Fetched ${newFeatures.length} features from OSM`);
  
      // Combine with existing features or replace
      const combined = appendMode ? [...features, ...newFeatures] : newFeatures;
      const unique = removeDuplicateFeatures(combined);
      
      setFeatures(unique);
      setStep(4);
  
      alert(`Successfully fetched ${newFeatures.length} features from OpenStreetMap`);
  
    } catch (error) {
      console.error('Error fetching from OSM:', error);
      alert(`Error fetching from OpenStreetMap: ${error.message}`);
    } finally {
      setIsFetchingOSM(false);
    }
  };

  const handleFileUpload = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const finalLayerName = isCustomLayer ? customLayerName : layerName;
    setIsProcessing(true);
    
    // Load ALL features across ALL domains for duplicate checking
    let allFeaturesForCheck = [];
    if (getAllFeatures && selectedCity) {
      try {
        allFeaturesForCheck = await getAllFeatures();
        console.log(`Loaded ${allFeaturesForCheck.length} features across ALL domains for duplicate checking during upload`);
      } catch (error) {
        console.error('Error loading all features:', error);
      }
    }
    
    // Helper function to get coordinate key
    const getCoordinateKey = (feature) => {
      if (!feature.geometry || !feature.geometry.coordinates) {
        return null;
      }
      
      let lat, lon;
      
      if (feature.geometry.type === 'Point') {
        [lon, lat] = feature.geometry.coordinates;
      } else if (feature.geometry.type === 'LineString' && feature.geometry.coordinates.length > 0) {
        [lon, lat] = feature.geometry.coordinates[0];
      } else if (feature.geometry.type === 'Polygon' && feature.geometry.coordinates.length > 0 && feature.geometry.coordinates[0].length > 0) {
        [lon, lat] = feature.geometry.coordinates[0][0];
      } else if (feature.geometry.type === 'MultiLineString' && feature.geometry.coordinates.length > 0 && feature.geometry.coordinates[0].length > 0) {
        [lon, lat] = feature.geometry.coordinates[0][0];
      } else if (feature.geometry.type === 'MultiPolygon' && feature.geometry.coordinates.length > 0 && feature.geometry.coordinates[0].length > 0 && feature.geometry.coordinates[0][0].length > 0) {
        [lon, lat] = feature.geometry.coordinates[0][0][0];
      } else {
        try {
          const turfFeature = { type: 'Feature', geometry: feature.geometry, properties: {} };
          const centroid = turf.centroid(turfFeature);
          [lon, lat] = centroid.geometry.coordinates;
        } catch (error) {
          return null;
        }
      }
      
      if (lon === undefined || lat === undefined || isNaN(lon) || isNaN(lat)) {
        return null;
      }
      
      return `${lat.toFixed(6)},${lon.toFixed(6)}`;
    };
    
    const processFeaturesWithDuplicateCheck = (parsedFeatures, totalParsedCount) => {
      console.log(`\n=== Processing ${parsedFeatures.length} parsed features ===`);
      
      // Step 1: Crop by boundary
      console.log('Step 1: Cropping features by city boundary...');
      const boundaryFiltered = parsedFeatures
        .map(f => cropFeatureByBoundary(f, cityBoundary))
        .filter(f => f !== null);
      const croppedOutCount = parsedFeatures.length - boundaryFiltered.length;
      console.log(`After boundary crop: ${boundaryFiltered.length} features (${croppedOutCount} removed)`);
      
      if (boundaryFiltered.length === 0) {
        alert(
          'All features in the uploaded file are outside the city boundary.\n\n' +
          `${parsedFeatures.length} feature${parsedFeatures.length > 1 ? 's were' : ' was'} found but none are within the city limits.\n\n` +
          'Please upload a file with features inside the city boundary or draw features manually.'
        );
        setIsProcessing(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
        return;
      }
      
      // Step 2: Combine with existing features if append mode
      const combined = appendMode ? [...features, ...boundaryFiltered] : boundaryFiltered;
      console.log(`Step 2: ${appendMode ? 'Append' : 'Replace'} mode - ${combined.length} total features to check`);
      
      // Step 3: Remove duplicates based on coordinates across ALL domains
      console.log('Step 3: Removing duplicates based on lat/lon coordinates across ALL domains...');
      
      // Build set of existing coordinates from ALL domains (excluding current layer if editing)
      const seenCoordinates = new Set();
      allFeaturesForCheck.forEach(feature => {
        if (!editingLayer || feature.properties?.layer_name !== finalLayerName) {
          const coordKey = getCoordinateKey(feature);
          if (coordKey) {
            seenCoordinates.add(coordKey);
          }
        }
      });
      
      console.log(`Found ${seenCoordinates.size} existing coordinates across ALL domains`);
      
      // Filter out duplicates
      const uniqueFeatures = [];
      let duplicatesFound = 0;
      
      combined.forEach((feature, index) => {
        const coordKey = getCoordinateKey(feature);
        
        if (!coordKey) {
          console.warn(`Could not extract coordinates from feature at index ${index}`);
          uniqueFeatures.push(feature);
          return;
        }
        
        if (seenCoordinates.has(coordKey)) {
          duplicatesFound++;
          console.log(`Duplicate found at index ${index}: coordinate ${coordKey} already exists`);
          return;
        }
        
        seenCoordinates.add(coordKey);
        uniqueFeatures.push(feature);
      });
      
      console.log(`After duplicate removal: ${uniqueFeatures.length} unique features (${duplicatesFound} duplicates removed)`);
      console.log(`=== Final Summary ===`);
      console.log(`- Parsed: ${totalParsedCount}`);
      console.log(`- Outside boundary: ${croppedOutCount}`);
      console.log(`- Duplicates across ALL domains: ${duplicatesFound}`);
      console.log(`- Final unique: ${uniqueFeatures.length}`);
      
      if (uniqueFeatures.length === 0) {
        const reasons = [];
        if (croppedOutCount > 0) {
          reasons.push(`${croppedOutCount} outside city boundary`);
        }
        if (duplicatesFound > 0) {
          reasons.push(`${duplicatesFound} duplicate${duplicatesFound > 1 ? 's' : ''}`);
        }
        
        alert(
          'No features remain after filtering.\n\n' +
          `${totalParsedCount} feature${totalParsedCount > 1 ? 's were' : ' was'} found in the file:\n` +
          `${reasons.join(' and ')}\n\n` +
          'Please upload a different file or draw features manually.'
        );
        setIsProcessing(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
        return;
      }
      
      // Build alert message
      const messages = [];
      if (croppedOutCount > 0) {
        messages.push(`${croppedOutCount} feature${croppedOutCount > 1 ? 's were' : ' was'} outside the city boundary`);
      }
      if (duplicatesFound > 0) {
        messages.push(`${duplicatesFound} duplicate feature${duplicatesFound > 1 ? 's were' : ' was'} found across ALL domains`);
      }
      
      if (messages.length > 0) {
        alert(
          `${messages.join(' and ')} and removed.\n\n` +
          `${uniqueFeatures.length} unique feature${uniqueFeatures.length > 1 ? 's' : ''} will be loaded for review.`
        );
      }
      
      setFeatures(uniqueFeatures);
      setStep(4);
      setIsProcessing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    };
    
    try {
      let newFeatures = [];
      let totalParsed = 0;
      
      if (files.length === 1) {
        const file = files[0];
        setUploadedFile(file);
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
                    domain_name: selectedDomain
                  }
                };
              }).filter(f => f !== null);
              totalParsed = parsedFeatures.length;
              console.log(`CSV: Parsed ${totalParsed} features`);
              processFeaturesWithDuplicateCheck(parsedFeatures, totalParsed);
            }
          });
          return;
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
                domain_name: selectedDomain
              }
            };
          }).filter(f => f !== null);
          totalParsed = parsedFeatures.length;
          console.log(`Parquet: Parsed ${totalParsed} features`);
          newFeatures = parsedFeatures;
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
                  domain_name: selectedDomain
                }
              };
            })
            .filter(f => f !== null);
          totalParsed = validFeatures.length;
          console.log(`GeoJSON: Parsed ${totalParsed} features`);
          newFeatures = validFeatures;
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
                  domain_name: selectedDomain
                }
              };
            })
            .filter(f => f !== null);
          totalParsed = validFeatures.length;
          console.log(`Shapefile (zip): Parsed ${totalParsed} features`);
          newFeatures = validFeatures;
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
                    domain_name: selectedDomain
                  }
                };
              })
              .filter(f => f !== null);
            totalParsed = validFeatures.length;
            console.log(`Shapefile (shp): Parsed ${totalParsed} features`);
            newFeatures = validFeatures;
          } catch (shpError) {
            console.warn('Single .shp file processing failed:', shpError);
            alert('Single .shp file could not be processed completely. Geometry loaded but attributes may be missing. For full data, please upload a .zip file or select all components (.shp, .dbf, .shx, .prj) together.');
          }
        } else {
          alert('For single file upload, please use GeoJSON (.geojson, .json), CSV (.csv), Parquet (.parquet), Zipped Shapefile (.zip), or Shapefile (.shp). For complete shapefiles, select all files (.shp, .dbf, .shx, .prj) together.');
          setIsProcessing(false);
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }
          return;
        }
        
        // Process non-CSV files
        if (fileExt !== 'csv') {
          processFeaturesWithDuplicateCheck(newFeatures, totalParsed);
        }
      } else {
        // Multiple files handling
        const fileGroups = {};
        const geojsonFiles = [];
        const zipFiles = [];
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const ext = file.name.toLowerCase().split('.').pop();
          const fileNameWithoutExt = file.name.substring(0, file.name.lastIndexOf('.'));
          if (['shp', 'dbf', 'shx', 'prj'].includes(ext)) {
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
                  domain_name: selectedDomain
                }
              };
            })
            .filter(f => f !== null);
        };
        
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
              newFeatures = newFeatures.concat(validFeatures);
            } catch (shpError) {
              console.warn(`Error processing shapefile set "${baseName}":`, shpError);
              alert(`Error processing shapefile set "${baseName}". Please ensure all required files (.shp, .dbf, .shx, .prj) are uploaded together.`);
            }
          }
        }
        
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
          return validFeatures;
        };
        
        for (const file of zipFiles) {
          const processedFeatures = await processZipFile(file, newFeatures);
          newFeatures = newFeatures.concat(processedFeatures);
        }
        
        const processGeoJsonFile = async (file, currentFeatures) => {
          const text = await file.text();
          const geojson = JSON.parse(text);
          let parsedFeatures = geojson.type === 'FeatureCollection'
            ? geojson.features
            : [geojson];
          const validFeatures = processFeatures(parsedFeatures, currentFeatures.length);
          totalParsed += validFeatures.length;
          return validFeatures;
        };
        
        for (const file of geojsonFiles) {
          const processedFeatures = await processGeoJsonFile(file, newFeatures);
          newFeatures = newFeatures.concat(processedFeatures);
        }
        
        if (newFeatures.length === 0) {
          alert('No valid features found in the uploaded files. Please ensure the files contain valid geographic data.');
          setIsProcessing(false);
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }
          return;
        }
        
        console.log(`Multiple files: Parsed ${totalParsed} features total`);
        processFeaturesWithDuplicateCheck(newFeatures, totalParsed);
      }
      
    } catch (error) {
      console.error('Error processing files:', error);
      let errorMessage = 'Error processing files';
      if (error.message && error.message.includes('no layers found')) {
        errorMessage = 'No valid geographic data found in the files. Please ensure the files contain valid shapefile or GeoJSON data.';
      } else if (error.message && error.message.includes('must be a string')) {
        errorMessage = 'Invalid file format. For shapefiles, please upload a .zip file or select all components together.';
      } else {
        errorMessage = 'Error processing files: ' + (error.message || error);
      }
      alert(errorMessage);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      setIsProcessing(false);
    }
  };

  const handleSave = async () => {
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
    
    // Load all features across ALL domains for duplicate checking
    console.log('Loading ALL features across ALL domains for final duplicate check...');
    let allFeaturesForCheck = [];
    
    if (getAllFeatures && selectedCity) {
      try {
        allFeaturesForCheck = await getAllFeatures();
        console.log(`Loaded ${allFeaturesForCheck.length} features across ALL domains for duplicate check`);
      } catch (error) {
        console.error('Error loading all features for duplicate check:', error);
      }
    }
    
    // Now check for duplicates
    const getCoordinateKey = (feature) => {
      if (!feature.geometry || !feature.geometry.coordinates) {
        return null;
      }
      
      let lat, lon;
      
      if (feature.geometry.type === 'Point') {
        [lon, lat] = feature.geometry.coordinates;
      } else if (feature.geometry.type === 'LineString' && feature.geometry.coordinates.length > 0) {
        [lon, lat] = feature.geometry.coordinates[0];
      } else if (feature.geometry.type === 'Polygon' && feature.geometry.coordinates.length > 0 && feature.geometry.coordinates[0].length > 0) {
        [lon, lat] = feature.geometry.coordinates[0][0];
      } else if (feature.geometry.type === 'MultiLineString' && feature.geometry.coordinates.length > 0 && feature.geometry.coordinates[0].length > 0) {
        [lon, lat] = feature.geometry.coordinates[0][0];
      } else if (feature.geometry.type === 'MultiPolygon' && feature.geometry.coordinates.length > 0 && feature.geometry.coordinates[0].length > 0 && feature.geometry.coordinates[0][0].length > 0) {
        [lon, lat] = feature.geometry.coordinates[0][0][0];
      } else {
        try {
          const turfFeature = { type: 'Feature', geometry: feature.geometry, properties: {} };
          const centroid = turf.centroid(turfFeature);
          [lon, lat] = centroid.geometry.coordinates;
        } catch (error) {
          return null;
        }
      }
      
      if (lon === undefined || lat === undefined || isNaN(lon) || isNaN(lat)) {
        return null;
      }
      
      return `${lat.toFixed(6)},${lon.toFixed(6)}`;
    };
    
    // Build set of existing coordinates (excluding current layer if editing)
    const seenCoordinates = new Set();
  allFeaturesForCheck.forEach(feature => {
    if (!editingLayer || feature.properties?.layer_name !== finalLayerName) {
      const coordKey = getCoordinateKey(feature);
      if (coordKey) {
        seenCoordinates.add(coordKey);
      }
    }
  });
  
  console.log(`Found ${seenCoordinates.size} existing coordinates across ALL domains`);
    
    // Filter out duplicates
    const uniqueFeatures = [];
    let duplicatesFound = 0;
    
    features.forEach((feature, index) => {
      const coordKey = getCoordinateKey(feature);
      
      if (!coordKey) {
        console.warn(`Could not extract coordinates from feature at index ${index}`);
        uniqueFeatures.push(feature);
        return;
      }
      
      if (seenCoordinates.has(coordKey)) {
        duplicatesFound++;
        console.log(`Duplicate found at index ${index}: coordinate ${coordKey} already exists in domain`);
        return;
      }
      
      // Also check within the current batch
      if (seenCoordinates.has(coordKey)) {
        duplicatesFound++;
        return;
      }
      
      seenCoordinates.add(coordKey);
      uniqueFeatures.push(feature);
    });
    
    console.log(`Duplicate check complete: ${uniqueFeatures.length} unique out of ${features.length} total`);
    
    if (duplicatesFound > 0) {
      const proceed = window.confirm(
        `${duplicatesFound} duplicate feature${duplicatesFound > 1 ? 's were' : ' was'} found.\n` +
        `These features have the same latitude/longitude as features already in OTHER layers across ALL domains.\n\n` +
        `Do you want to save only the ${uniqueFeatures.length} unique features?`
      );
      
      if (!proceed) {
        return;
      }
    }
    
    if (uniqueFeatures.length === 0) {
      alert('No unique features to save. All features are duplicates.');
      return;
    }
    
    // Save with unique features only
    onSave({
      name: finalLayerName,
      icon: finalLayerIcon,
      domain: selectedDomain,
      features: uniqueFeatures
    });
    
    console.log('Layer saved:', { name: finalLayerName, icon: finalLayerIcon, domain: selectedDomain, features: uniqueFeatures });
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
    setSelectedDomain(domain || '');
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
                <button
                  className="btn-secondary"
                  onClick={() => {
                    setEditingFeatureName(null);
                    setFeatureNameInput('');
                  }}
                >
                  Cancel
                </button>
                <button
                  className="btn-primary"
                  onClick={updateFeatureName}
                >
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
                  <label>Select Domain *</label>
                  <select
                    value={selectedDomain}
                    onChange={(e) => {
                      const newDomain = e.target.value;
                      setSelectedDomain(newDomain);
                      setLayerName('');
                      setIsCustomLayer(false);
                      setCustomLayerName('');
                      setCustomLayerIcon('fas fa-map-marker-alt');
                      setNameError('');
                    }}
                  >
                    <option value="">Choose a domain...</option>
                    {Object.keys(domainIcons).map(domainKey => (
                      <option key={domainKey} value={domainKey}>
                        {formatDomainName(domainKey)}
                      </option>
                    ))}
                  </select>
                  <small>Select the domain category for this layer</small>
                </div>
                {selectedDomain && (
                  <>
                    <div className="form-group">
                      <label>Select Layer *</label>
                      {predefinedLayers.length === 0 && !editingLayer ? (
                        <div style={{ 
                          padding: '16px', 
                          background: '#fef3c7', 
                          border: '1px solid #fbbf24',
                          borderRadius: '8px',
                          marginBottom: '12px'
                        }}>
                          <p style={{ margin: 0, color: '#92400e', fontSize: '14px' }}>
                            <i className="fas fa-info-circle" style={{ marginRight: '8px' }}></i>
                            All predefined layers for this domain have been added. You can create a custom layer instead.
                          </p>
                        </div>
                      ) : null}
                      <select
                        value={isCustomLayer ? 'custom' : layerName}
                        onChange={handleLayerSelection}
                        disabled={!!editingLayer || predefinedLayers.length === 0}
                      >
                        <option value="">
                          {predefinedLayers.length === 0 && !editingLayer 
                            ? 'No available layers - create custom' 
                            : 'Choose a layer...'}
                        </option>
                        {predefinedLayers.map(layer => (
                          <option key={layer.name} value={layer.name}>
                            {layer.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                          </option>
                        ))}
                        <option value="custom">+ Add Custom Layer</option>
                      </select>
                      <small>
                        {predefinedLayers.length === 0 && !editingLayer
                          ? 'Create a custom layer with your own name and icon'
                          : 'Select a predefined layer or create a custom one'}
                      </small>
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
                          <i className={layerIcon} style={{ fontSize: '24px', color: currentDomainColor }}></i>
                          <span>{layerName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</span>
                        </div>
                      </div>
                    )}
                  </>
                )}
                <div className="form-actions">
                  <button className="btn-secondary" onClick={handleClose}>
                    Cancel
                  </button>
                  <button
                    className="btn-primary"
                    onClick={() => {
                      // Double-check before proceeding
                      const finalLayerName = isCustomLayer ? customLayerName : layerName;
                      const validationError = validateLayerName(finalLayerName);
                      
                      if (validationError) {
                        alert(validationError);
                        return;
                      }
                      
                      setStep(2);
                    }}
                    disabled={!selectedDomain || (isCustomLayer ? (!customLayerName || !!nameError) : !layerName)}
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
                  <button
                    className={`source-option ${dataSource === 'osm' ? 'selected' : ''}`}
                    onClick={() => setDataSource('osm')}
                  >
                    <i className="fas fa-map-marked-alt"></i>
                    <h4>Fetch from OSM</h4>
                    <p>Query OpenStreetMap using tags</p>
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
                        <i className="fas fa-spinner fa-spin"></i>
                        Processing file...
                      </div>
                    )}
                  </div>
                ) : dataSource === 'osm' ? (
                  <div className="osm-section">
                    <div className="form-group">
                      <label>OpenStreetMap Tags</label>
                      <small>Define tags to query from OpenStreetMap. Use "*" as value to match any value for that key.</small>
                      
                      <div className="osm-tags-list" style={{ marginTop: '12px' }}>
                        {osmTags.map((tag, index) => (
                          <div key={index} className="osm-tag-row" style={{ 
                            display: 'flex', 
                            gap: '8px', 
                            marginBottom: '8px',
                            alignItems: 'center'
                          }}>
                            <input
                              type="text"
                              placeholder="Key (e.g., amenity)"
                              value={tag.key}
                              onChange={(e) => handleOsmTagChange(index, 'key', e.target.value)}
                              style={{ flex: '1' }}
                            />
                            <input
                              type="text"
                              placeholder="Value (e.g., restaurant or *)"
                              value={tag.value}
                              onChange={(e) => handleOsmTagChange(index, 'value', e.target.value)}
                              style={{ flex: '1' }}
                            />
                            <button
                              className="btn-secondary"
                              onClick={() => handleRemoveOsmTag(index)}
                              disabled={osmTags.length === 1}
                              style={{ padding: '8px 12px', minWidth: 'unset' }}
                            >
                              <i className="fas fa-trash"></i>
                            </button>
                          </div>
                        ))}
                      </div>
                      
                      <button
                        className="btn-secondary"
                        onClick={handleAddOsmTag}
                        style={{ marginTop: '8px' }}
                      >
                        <i className="fas fa-plus"></i> Add Tag
                      </button>
                    </div>
            
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
            
                    <button
                      className="btn-primary"
                      onClick={handleFetchFromOSM}
                      disabled={isFetchingOSM || osmTags.every(t => !t.key.trim())}
                      style={{ width: '100%', marginTop: '16px' }}
                    >
                      {isFetchingOSM ? (
                        <>
                          <i className="fas fa-spinner fa-spin"></i> Fetching from OSM...
                        </>
                      ) : (
                        <>
                          <i className="fas fa-download"></i> Fetch Features
                        </>
                      )}
                    </button>
            
                    {isFetchingOSM && (
                      <div className="processing-indicator">
                        <i className="fas fa-spinner fa-spin"></i>
                        Querying OpenStreetMap...
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="draw-section">
                    <div ref={mapRef} className="map-container"></div>
                    <div className="draw-instructions">
                      <p>
                        <i className="fas fa-info-circle"></i> Use the drawing tools to add features. Click markers to edit names. Features: {features.length}
                      </p>
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
                  <div className="append-upload-section">
                    <button
                      className="btn-secondary"
                      onClick={() => {
                        setDataSource('upload');
                        setAppendMode(true);
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
                      <p>
                        <i className="fas fa-info-circle"></i> Review and edit your features using the map tools. Click on markers to edit feature names. Current features: {features.length}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="form-actions">
                  <button
                    className="btn-secondary"
                    onClick={() => {
                      if (reviewMapInstanceRef.current) {
                        reviewMapInstanceRef.current.remove();
                        reviewMapInstanceRef.current = null;
                        console.log('Review map closed on back navigation');
                      }
                      setDataSource('upload');
                      setStep(3);
                    }}
                  >
                    <i className="fas fa-arrow-left"></i> Back
                  </button>
                  <button
                    className="btn-primary"
                    onClick={handleSave}
                    disabled={features.length === 0}
                  >
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
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
  const [showDomainDropdown, setShowDomainDropdown] = useState(false);
  const [showLayerDropdown, setShowLayerDropdown] = useState(false);
  const [domainSearchQuery, setDomainSearchQuery] = useState('');
  const [layerSearchQuery, setLayerSearchQuery] = useState('');
  const [originalLayerName, setOriginalLayerName] = useState('');
  const [originalDomain, setOriginalDomain] = useState('');
  const [isDomainChanged, setIsDomainChanged] = useState(false);

  // Scroll to top of modal when step changes
  useEffect(() => {
    const modalContent = document.querySelector('.layer-form');
    if (modalContent) {
      modalContent.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
    }
  }, [step]);

  useEffect(() => {
  }, [mapView]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showDomainDropdown && !event.target.closest('.domain-dropdown-wrapper')) {
        setShowDomainDropdown(false);
      }
      if (showLayerDropdown && !event.target.closest('.layer-dropdown-wrapper')) {
        setShowLayerDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showDomainDropdown, showLayerDropdown]);

  useEffect(() => {
    const loadAllFeatures = async () => {
      if (getAllFeatures && selectedCity) {
        try {
          const features = await getAllFeatures();
          setAllCityFeatures(features);
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

  const availableIcons = useMemo(() => [
    'fas fa-map-marker-alt', 'fas fa-heart', 'fas fa-star', 'fas fa-traffic-light', 'fas fa-wifi',
    'fas fa-wheelchair', 'fas fa-baby', 'fas fa-toilet', 'fas fa-ban',
    'fas fa-trash', 'fas fa-recycle', 'fas fa-helmet-safety', 'fas fa-taxi', 'fas fa-truck',
    'fas fa-ferry', 'fas fa-helicopter', 'fas fa-shuttle-space', 'fas fa-anchor',
    'fas fa-phone', 'fas fa-envelope', 'fas fa-gavel', 'fas fa-tower-cell', 'fas fa-tower-broadcast',
    'fas fa-plug', 'fas fa-syringe', 'fas fa-monument', 'fas fa-landmark-dome',
    'fas fa-tractor', 'fas fa-spa', 'fas fa-binoculars', 'fas fa-kiwi-bird', 'fas fa-fish',
    'fas fa-umbrella-beach', 'fas fa-volcano', 'fas fa-tornado', 'fas fa-tents'
  ], []);

  const domainIcons = useMemo(() => ({
    mobility: 'fas fa-car',
    governance: 'fas fa-landmark',
    health: 'fas fa-heartbeat',
    economy: 'fas fa-chart-line',
    environment: 'fas fa-leaf',
    culture: 'fas fa-palette',
    education: 'fas fa-graduation-cap',
    housing: 'fas fa-home',
    social: 'fas fa-users',
  }), []);

  const formatDomainName = (domainName) => {
    if (!domainName) return '';
    return domainName.charAt(0).toUpperCase() + domainName.slice(1);
  };

  const currentDomainColor = useMemo(() => {
    return selectedDomain && domainColors ? domainColors[selectedDomain] : (domainColor || '#666666');
  }, [selectedDomain, domainColors, domainColor]);

  const predefinedLayers = useMemo(() => {
    const allLayers = layerDefs[selectedDomain] || [];
    const currentExistingLayers = selectedDomain && domainColors
      ? (availableLayersByDomain?.[selectedDomain] || [])
      : existingLayers;
    
    const availableLayers = allLayers.filter(layer => {
      const layerExists = currentExistingLayers.some(existing => 
        existing.name === layer.name && (!editingLayer || editingLayer.name !== layer.name)
      );
      return !layerExists;
    });
    
    // Sort alphabetically by name
    return availableLayers.sort((a, b) => a.name.localeCompare(b.name));
  }, [selectedDomain, existingLayers, editingLayer, domainColors, availableLayersByDomain]);

  const filteredAndSortedDomains = useMemo(() => {
    const domains = Object.keys(domainIcons);
    
    // Filter by search query
    const filtered = domainSearchQuery
      ? domains.filter(domainKey =>
          formatDomainName(domainKey).toLowerCase().includes(domainSearchQuery.toLowerCase())
        )
      : domains;
    
    // Sort alphabetically
    return filtered.sort((a, b) => formatDomainName(a).localeCompare(formatDomainName(b)));
  }, [domainSearchQuery, domainIcons]);

  const filteredLayers = useMemo(() => {
    if (!layerSearchQuery) return predefinedLayers;
    
    return predefinedLayers.filter(layer =>
      layer.name.replace(/_/g, ' ').toLowerCase().includes(layerSearchQuery.toLowerCase())
    );
  }, [predefinedLayers, layerSearchQuery]);

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

  const getGeometryHash = (geometry) => {
    if (!geometry || !geometry.coordinates) return null;
    
    try {
      // Round coordinates to 6 decimal places for comparison (about 0.1 meter precision)
      const roundCoord = (coord) => {
        if (Array.isArray(coord[0])) {
          return coord.map(roundCoord);
        }
        return [Number(coord[0].toFixed(6)), Number(coord[1].toFixed(6))];
      };
      
      const roundedCoords = roundCoord(geometry.coordinates);
      return `${geometry.type}:${JSON.stringify(roundedCoords)}`;
    } catch (error) {
      console.warn('Error creating geometry hash:', error);
      return null;
    }
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
      
      // Check if feature intersects boundary at all
      const intersects = turf.booleanIntersects(turfFeature, boundaryFeature);
      if (!intersects) {
        return null;
      }
      
      if (feature.geometry.type === 'Point') {
        const isWithin = turf.booleanPointInPolygon(turfFeature, boundaryFeature);
        return isWithin ? feature : null;
        
      } else if (feature.geometry.type === 'LineString') {
        try {
          // Check if completely within
          const isFullyWithin = turf.booleanWithin(turfFeature, boundaryFeature);
          
          // Even if booleanWithin returns true, check if line intersects boundary edge
          let lineIntersectsBoundary = false;
          try {
            const intersections = turf.lineIntersect(turfFeature, boundaryFeature);
            lineIntersectsBoundary = intersections.features.length > 0;
          } catch (intersectError) {
            console.warn('Error checking line intersection with boundary:', intersectError);
          }
          
          if (isFullyWithin && !lineIntersectsBoundary) {
            return feature;
          }
          
          // Line crosses boundary - need to clip it segment by segment
          const coords = feature.geometry.coordinates;
          const clippedSegments = [];
          let currentSegment = [];
          
          for (let i = 0; i < coords.length - 1; i++) {
            const point1 = coords[i];
            const point2 = coords[i + 1];
            
            const p1Inside = turf.booleanPointInPolygon(turf.point(point1), boundaryFeature);
            const p2Inside = turf.booleanPointInPolygon(turf.point(point2), boundaryFeature);
            
            if (p1Inside && p2Inside) {
              // Both points inside - BUT check if this specific segment crosses boundary
              const segment = turf.lineString([point1, point2]);
              let segmentCrossesBoundary = false;
              try {
                const segmentIntersections = turf.lineIntersect(segment, boundaryFeature);
                segmentCrossesBoundary = segmentIntersections.features.length > 0;
              } catch (err) {
                console.warn('Error checking segment intersection:', err);
              }
              
              if (!segmentCrossesBoundary) {
                // Truly inside - add to current segment
                if (currentSegment.length === 0) {
                  currentSegment.push(point1);
                }
                currentSegment.push(point2);
              } else {
                // Segment goes outside and comes back in - need to split                
                if (currentSegment.length === 0) {
                  currentSegment.push(point1);
                }
                
                // Find intersection points
                const intersections = turf.lineIntersect(segment, boundaryFeature);
                if (intersections.features.length >= 2) {
                  // Exit and re-entry
                  const exitPoint = intersections.features[0].geometry.coordinates;
                  const entryPoint = intersections.features[1].geometry.coordinates;
                  
                  // Complete current segment at exit point
                  currentSegment.push(exitPoint);
                  if (currentSegment.length >= 2) {
                    clippedSegments.push([...currentSegment]);
                  }
                  
                  // Start new segment at entry point
                  currentSegment = [entryPoint, point2];
                }
              }
              
            } else if (p1Inside && !p2Inside) {
              // Crossing from inside to outside - find intersection and end segment
              if (currentSegment.length === 0) {
                currentSegment.push(point1);
              }
              
              // Find where this segment crosses the boundary
              const segment = turf.lineString([point1, point2]);
              try {
                const intersections = turf.lineIntersect(segment, boundaryFeature);
                if (intersections.features.length > 0) {
                  // Add the intersection point (exit point)
                  const exitPoint = intersections.features[0].geometry.coordinates;
                  currentSegment.push(exitPoint);
                }
              } catch (err) {
                console.warn('Error finding exit intersection:', err);
              }
              
              // Save this segment
              if (currentSegment.length >= 2) {
                clippedSegments.push([...currentSegment]);
              }
              currentSegment = [];
              
            } else if (!p1Inside && p2Inside) {
              // Crossing from outside to inside - find intersection and start new segment
              const segment = turf.lineString([point1, point2]);
              try {
                const intersections = turf.lineIntersect(segment, boundaryFeature);
                if (intersections.features.length > 0) {
                  // Start new segment with entry point
                  const entryPoint = intersections.features[0].geometry.coordinates;
                  currentSegment = [entryPoint, point2];
                } else {
                  // No intersection found, start with p2
                  currentSegment = [point2];
                }
              } catch (err) {
                console.warn('Error finding entry intersection:', err);
                currentSegment = [point2];
              }
              
            } else {
              // Both points outside
              // Check if segment crosses through the boundary (enters and exits)
              const segment = turf.lineString([point1, point2]);
              try {
                const intersections = turf.lineIntersect(segment, boundaryFeature);
                if (intersections.features.length >= 2) {
                  // Segment passes through boundary - keep the middle part
                  const entry = intersections.features[0].geometry.coordinates;
                  const exit = intersections.features[1].geometry.coordinates;
                  clippedSegments.push([entry, exit]);
                }
              } catch (err) {
                console.warn('Error checking segment crossing:', err);
              }
              // If segment doesn't cross boundary, ignore it
            }
          }
          
          // Don't forget the last segment if we were building one
          if (currentSegment.length >= 2) {
            clippedSegments.push(currentSegment);
          }
          
          if (clippedSegments.length === 0) {
            return null;
          } else if (clippedSegments.length === 1) {
            return {
              ...feature,
              geometry: {
                type: 'LineString',
                coordinates: clippedSegments[0]
              }
            };
          } else {
            return {
              ...feature,
              geometry: {
                type: 'MultiLineString',
                coordinates: clippedSegments
              }
            };
          }
        } catch (clipError) {
          console.error('Error clipping LineString:', clipError);
          return feature;
        }
        
      } else if (feature.geometry.type === 'MultiLineString') {
        try {
          const allClippedSegments = [];
          
          for (const lineCoords of feature.geometry.coordinates) {
            const lineFeature = {
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: lineCoords },
              properties: {}
            };
            
            // Check if this line intersects boundary
            if (!turf.booleanIntersects(lineFeature, boundaryFeature)) {
              continue;
            }
            
            // Check if completely within
            const isFullyWithin = turf.booleanWithin(lineFeature, boundaryFeature);
            
            // Even if booleanWithin returns true, check if line intersects boundary edge
            let lineIntersectsBoundary = false;
            try {
              const intersections = turf.lineIntersect(lineFeature, boundaryFeature);
              lineIntersectsBoundary = intersections.features.length > 0;
            } catch (intersectError) {
              console.warn('Error checking line intersection with boundary:', intersectError);
            }
            
            if (isFullyWithin && !lineIntersectsBoundary) {
              allClippedSegments.push(lineCoords);
              continue;
            }
            
            // Line crosses boundary - clip it segment by segment
            let currentSegment = [];
            
            for (let i = 0; i < lineCoords.length - 1; i++) {
              const point1 = lineCoords[i];
              const point2 = lineCoords[i + 1];
              
              const p1Inside = turf.booleanPointInPolygon(turf.point(point1), boundaryFeature);
              const p2Inside = turf.booleanPointInPolygon(turf.point(point2), boundaryFeature);
              
              if (p1Inside && p2Inside) {
                // Both points inside - BUT check if this specific segment crosses boundary
                const segment = turf.lineString([point1, point2]);
                let segmentCrossesBoundary = false;
                try {
                  const segmentIntersections = turf.lineIntersect(segment, boundaryFeature);
                  segmentCrossesBoundary = segmentIntersections.features.length > 0;
                } catch (err) {
                  console.warn('Error checking segment intersection:', err);
                }
                
                if (!segmentCrossesBoundary) {
                  // Truly inside - add to current segment
                  if (currentSegment.length === 0) {
                    currentSegment.push(point1);
                  }
                  currentSegment.push(point2);
                } else {
                  // Segment goes outside and comes back in - need to split                  
                  if (currentSegment.length === 0) {
                    currentSegment.push(point1);
                  }
                  
                  // Find intersection points
                  const intersections = turf.lineIntersect(segment, boundaryFeature);
                  if (intersections.features.length >= 2) {
                    // Exit and re-entry
                    const exitPoint = intersections.features[0].geometry.coordinates;
                    const entryPoint = intersections.features[1].geometry.coordinates;
                    
                    // Complete current segment at exit point
                    currentSegment.push(exitPoint);
                    if (currentSegment.length >= 2) {
                      allClippedSegments.push([...currentSegment]);
                    }
                    
                    // Start new segment at entry point
                    currentSegment = [entryPoint, point2];
                  }
                }
                
              } else if (p1Inside && !p2Inside) {
                // Exit boundary
                if (currentSegment.length === 0) {
                  currentSegment.push(point1);
                }
                
                const segment = turf.lineString([point1, point2]);
                try {
                  const intersections = turf.lineIntersect(segment, boundaryFeature);
                  if (intersections.features.length > 0) {
                    currentSegment.push(intersections.features[0].geometry.coordinates);
                  }
                } catch (err) {
                  console.warn('Error finding exit intersection:', err);
                }
                
                if (currentSegment.length >= 2) {
                  allClippedSegments.push([...currentSegment]);
                }
                currentSegment = [];
                
              } else if (!p1Inside && p2Inside) {
                // Enter boundary
                const segment = turf.lineString([point1, point2]);
                try {
                  const intersections = turf.lineIntersect(segment, boundaryFeature);
                  if (intersections.features.length > 0) {
                    currentSegment = [intersections.features[0].geometry.coordinates, point2];
                  } else {
                    currentSegment = [point2];
                  }
                } catch (err) {
                  console.warn('Error finding entry intersection:', err);
                  currentSegment = [point2];
                }
                
              } else {
                // Both outside - check for pass-through
                const segment = turf.lineString([point1, point2]);
                try {
                  const intersections = turf.lineIntersect(segment, boundaryFeature);
                  if (intersections.features.length >= 2) {
                    allClippedSegments.push([
                      intersections.features[0].geometry.coordinates,
                      intersections.features[1].geometry.coordinates
                    ]);
                  }
                } catch (err) {
                  console.warn('Error checking segment crossing:', err);
                }
              }
            }
            
            if (currentSegment.length >= 2) {
              allClippedSegments.push(currentSegment);
            }
          }
          
          if (allClippedSegments.length === 0) {
            return null;
          } else if (allClippedSegments.length === 1) {
            return {
              ...feature,
              geometry: {
                type: 'LineString',
                coordinates: allClippedSegments[0]
              }
            };
          } else {
            return {
              ...feature,
              geometry: {
                type: 'MultiLineString',
                coordinates: allClippedSegments
              }
            };
          }
        } catch (multiLineError) {
          console.error('Error processing MultiLineString:', multiLineError);
          return feature;
        }
        
      } else if (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon') {
        try {
          const intersection = turf.intersect(turfFeature, boundaryFeature);
          
          if (intersection && intersection.geometry) {
            return {
              ...feature,
              geometry: intersection.geometry
            };
          } else {
            const isFullyWithin = turf.booleanWithin(turfFeature, boundaryFeature);
            if (isFullyWithin) {
              return feature;
            }
            return null;
          }
        } catch (intersectError) {
          console.warn('Error intersecting polygon:', intersectError);
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
    const seenGeometries = new Set();
    
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
    
    // Add all existing domain features' coordinates and geometries to the seen sets
    allCityFeatures.forEach(feature => {
      if (!editingLayer || feature.properties?.layer_name !== editingLayer.name) {
        const coordKey = getCoordinateKey(feature);
        if (coordKey) {
          seenCoordinates.add(coordKey);
        }
        
        const geomHash = getGeometryHash(feature.geometry);
        if (geomHash) {
          seenGeometries.add(geomHash);
        }
      }
    });
    
    // Then process new features
    let duplicatesFound = 0;
    let geometryDuplicatesFound = 0;
    
    newFeatures.forEach((newFeature, index) => {
      const coordKey = getCoordinateKey(newFeature);
      const geomHash = getGeometryHash(newFeature.geometry);
      
      if (!coordKey && !geomHash) {
        console.warn(`Could not extract coordinates or geometry from feature at index ${index}`);
        uniqueFeatures.push(newFeature);
        return;
      }
      
      // Check if this coordinate already exists
      if (coordKey && seenCoordinates.has(coordKey)) {
        duplicatesFound++;
        return;
      }
      
      // Check if this exact geometry already exists
      if (geomHash && seenGeometries.has(geomHash)) {
        geometryDuplicatesFound++;
        return;
      }
      
      // Add to unique features and mark coordinate and geometry as seen
      if (coordKey) seenCoordinates.add(coordKey);
      if (geomHash) seenGeometries.add(geomHash);
      uniqueFeatures.push(newFeature);
    });
    
    const totalDuplicates = duplicatesFound + geometryDuplicatesFound;
    
    if (totalDuplicates > 0) {      
      alert(
        `${totalDuplicates} duplicate feature${totalDuplicates > 1 ? 's were' : ' was'} removed.\n` +
        `(${duplicatesFound} coordinate duplicates, ${geometryDuplicatesFound} geometry duplicates)\n` +
        `These features already exist in the ${selectedDomain} domain.`
      );
    }
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
      }
    });
    setFeatures(newFeatures);
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
  
    // 1. Check if name already exists in the current domain (from saved layers)
    const layerExistsInDomain = currentExistingLayers.some(layer => {
      if (editingLayer) {
        // Allow current layer's name during edit
        return layer.name === name && editingLayer.name !== name;
      }
      return layer.name === name;
    });
  
    if (layerExistsInDomain) {
      return `A layer named "${name}" already exists in this domain`;
    }
  
    // 2. Check predefined layer conflicts — BUT ALLOW if using the official one
    const predefinedInCurrentDomain = (layerDefs[selectedDomain] || []).find(l => l.name === name);
  
    if (predefinedInCurrentDomain) {
      // This is a predefined layer in the selected domain
      if (isCustomLayer) {
        // You're in custom mode → BLOCK using predefined name
        return `Layer name "${name}" is reserved for the predefined "${predefinedInCurrentDomain.name.replace(/_/g, ' ')}" layer in ${formatDomainName(selectedDomain)}`;
      }
  
      // You're using the predefined selector
      const expectedIcon = predefinedInCurrentDomain.icon;
      const actualIcon = layerIcon;
  
      if (actualIcon !== expectedIcon) {
        // Wrong icon → treat as custom → BLOCK
        return `Layer name "${name}" is reserved for the official "${predefinedInCurrentDomain.name.replace(/_/g, ' ')}" layer`;
      }
  
      // Correct domain + correct icon + not custom → ALLOW
      return '';
    }
  
    // 3. Name is not a predefined layer in current domain → check globally
    const isPredefinedAnywhere = Object.values(layerDefs).some(domainLayers =>
      domainLayers.some(l => l.name === name)
    );
  
    if (isPredefinedAnywhere) {
      const conflictingDomain = Object.entries(layerDefs).find(([_, layers]) =>
        layers.some(l => l.name === name)
      )?.[0];
  
      return `Layer name "${name}" conflicts with a predefined layer in the ${formatDomainName(conflictingDomain)} domain`;
    }
    return '';
  }, [selectedDomain, existingLayers, editingLayer, domainColors, availableLayersByDomain, isCustomLayer, layerIcon]);

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
      
      // Always clear the custom layer name when switching to custom mode
      setCustomLayerName('');
      // Always select first icon for custom layer
      setCustomLayerIcon(availableIcons[0]);
      setNameError('');
    } else {
      const currentExistingLayers = selectedDomain && domainColors
        ? (availableLayersByDomain?.[selectedDomain] || [])
        : existingLayers;
      
      // When editing, allow selecting the current layer or checking against others
      const layerExists = currentExistingLayers.some(layer => 
        layer.name === value && editingLayer && editingLayer.name !== value
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
        
        if (tagArray.length > 0) {
          setOsmTags(tagArray);
        }
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
        
        // Store original layer info for reference
        setOriginalLayerName(editingLayer.name);
        setOriginalDomain(domain || '');
        
        // Set initial domain
        setSelectedDomain(domain || '');
  
        const currentPredefinedLayers = domain ? (layerDefs[domain] || []) : [];
        const predefinedLayer = currentPredefinedLayers.find(l => l.name === editingLayer.name);
  
        if (predefinedLayer) {
          // It's a predefined layer - select it in the dropdown
          setIsCustomLayer(false);
          setLayerName(editingLayer.name);
          setLayerIcon(predefinedLayer.icon);
          setCustomLayerName('');
          setCustomLayerIcon('fas fa-map-marker-alt');
        } else {
          // It's a custom layer
          setIsCustomLayer(true);
          setCustomLayerName(editingLayer.name);
          setCustomLayerIcon(editingLayer.icon);
          setLayerName('');
          setLayerIcon('fas fa-map-marker-alt');
        }
        
        try {
          const loadedFeatures = await loadLayerForEditing(
            cityName,
            domain,
            editingLayer.name
          );
          const validFeatures = (loadedFeatures || []).filter((f, i) => validateFeature(f, i));
          setFeatures(validFeatures);
          setStep(1);
          setDataSource('draw');
        } catch (error) {
          console.error('Error loading layer for editing:', error);
          alert('Failed to load layer data for editing');
          setFeatures([]);
        } finally {
          setIsLoadingExisting(false);
        }
      } else {
        // Reset for new layer
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
        setOriginalLayerName('');
        setOriginalDomain('');
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
        position: 'topright',
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
      
      // Add center control
      const centerControl = new CenterMapControl();
      map.addControl(centerControl);
      
      // Store boundary in map container for center control
      if (cityBoundary) {
        try {
          const boundaryGeojson = typeof cityBoundary === 'string'
            ? JSON.parse(cityBoundary)
            : cityBoundary;
          map.getContainer().dataset.boundary = JSON.stringify(boundaryGeojson);
        } catch (error) {
          console.error('Error storing boundary for center control:', error);
        }
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
            drawnItems.addLayer(marker);
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
          map.removeLayer(layer);
          
          let croppedLayer;
          
          if (croppedFeature.geometry.type === 'Point') {
            const [lon, lat] = croppedFeature.geometry.coordinates;
            croppedLayer = L.marker([lat, lon], {
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
          } else {
            // For lines and polygons, create GeoJSON layer with cropped geometry
            croppedLayer = L.geoJSON(croppedFeature.geometry, {
              style: {
                color: currentDomainColor,
                weight: 3,
                opacity: 0.9,
                fillColor: currentDomainColor,
                fillOpacity: 0.3
              }
            });
          }
          
          // Add the cropped layer to drawnItems
          if (croppedLayer instanceof L.LayerGroup) {
            croppedLayer.eachLayer(l => drawnItems.addLayer(l));
          } else {
            drawnItems.addLayer(croppedLayer);
          }
          
          // Update features state
          setFeatures(prev => [...prev, croppedFeature]);
          
          // Add popup to the cropped layer
          const popupContent = createPopupContent(
            croppedFeature, 
            featureIndex, 
            finalLayerName, 
            selectedDomain, 
            croppedFeature.geometry.type !== 'Point'
          );
          
          if (croppedLayer instanceof L.LayerGroup) {
            croppedLayer.eachLayer(l => {
              l.bindPopup(popupContent, {
                closeButton: true,
                className: 'feature-marker-popup'
              });
            });
          } else {
            croppedLayer.bindPopup(popupContent, {
              closeButton: true,
              className: 'feature-marker-popup'
            });
          }
          
          // Add centroid marker for non-point geometries
          if (croppedFeature.geometry.type !== 'Point') {
            try {
              const tempLayer = L.geoJSON(croppedFeature.geometry);
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
                
                const centroidPopupContent = createPopupContent(
                  croppedFeature, 
                  featureIndex, 
                  finalLayerName, 
                  selectedDomain, 
                  true
                );
                centroidMarker.bindPopup(centroidPopupContent, {
                  closeButton: true,
                  className: 'feature-marker-popup'
                });
                centroidGroup.addLayer(centroidMarker);
              }
            } catch (error) {
              console.error(`Drawing map: Error adding centroid at index ${featureIndex}:`, error);
            }
          }
          
          // Auto-open name editor
          setTimeout(() => {
            setEditingFeatureName(featureIndex);
            setFeatureNameInput(`Feature ${featureIndex + 1}`);
          }, 100);
        } else {
          console.warn('Feature is outside city boundary in drawing map:', newFeature);
          
          // If cropping resulted in null (completely outside), show alert
          if (!croppedFeature) {
            alert('Feature is completely outside the city boundary and was not added.');
          } else {
            alert('The feature you drew extends outside the city boundary. Only the portion inside the boundary has been kept.');
          }
        }
      });
      map.on(L.Draw.Event.EDITED, () => {
        updateFeaturesFromMap(drawnItemsRef.current);
      });
      map.on(L.Draw.Event.DELETED, () => {
        updateFeaturesFromMap(drawnItemsRef.current);
      });
      mapInstanceRef.current = map;
    };
    setTimeout(initializeMap, 100);
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
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
        position: 'topright',
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
      
      // Add center control
      const centerControl = new CenterMapControl();
      map.addControl(centerControl);
      
      // Store boundary in map container for center control
      if (cityBoundary) {
        try {
          const boundaryGeojson = typeof cityBoundary === 'string'
            ? JSON.parse(cityBoundary)
            : cityBoundary;
          map.getContainer().dataset.boundary = JSON.stringify(boundaryGeojson);
        } catch (error) {
          console.error('Error storing boundary for center control:', error);
        }
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
            drawnItems.addLayer(marker);
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
          // Add the CROPPED geometry to the map
          let croppedLayer;
          
          if (croppedFeature.geometry.type === 'Point') {
            const [lon, lat] = croppedFeature.geometry.coordinates;
            croppedLayer = L.marker([lat, lon], {
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
          } else {
            croppedLayer = L.geoJSON(croppedFeature.geometry, {
              style: {
                color: currentDomainColor,
                weight: 3,
                opacity: 0.9,
                fillColor: currentDomainColor,
                fillOpacity: 0.3
              }
            });
          }
          
          // Add to drawnItems
          if (croppedLayer instanceof L.LayerGroup) {
            croppedLayer.eachLayer(l => reviewDrawnItemsRef.current.addLayer(l));
          } else {
            reviewDrawnItemsRef.current.addLayer(croppedLayer);
          }
          
          setFeatures(prev => [...prev, croppedFeature]);
          
          const popupContent = createPopupContent(
            croppedFeature, 
            featureIndex, 
            finalLayerName, 
            selectedDomain, 
            croppedFeature.geometry.type !== 'Point'
          );
          
          if (croppedLayer instanceof L.LayerGroup) {
            croppedLayer.eachLayer(l => {
              l.bindPopup(popupContent, {
                closeButton: true,
                className: 'feature-marker-popup'
              });
            });
          } else {
            croppedLayer.bindPopup(popupContent, {
              closeButton: true,
              className: 'feature-marker-popup'
            });
          }
          
          // Add centroid for non-point geometries
          if (croppedFeature.geometry.type !== 'Point') {
            try {
              const tempLayer = L.geoJSON(croppedFeature.geometry);
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
                
                const centroidPopupContent = createPopupContent(
                  croppedFeature, 
                  featureIndex, 
                  finalLayerName, 
                  selectedDomain, 
                  true
                );
                centroidMarker.bindPopup(centroidPopupContent, {
                  closeButton: true,
                  className: 'feature-marker-popup'
                });
                reviewCentroidGroupRef.current.addLayer(centroidMarker);
              }
            } catch (error) {
              console.error(`Review map: Error adding centroid at index ${featureIndex}:`, error);
            }
          }
        } else {
          if (!croppedFeature) {
            alert('Feature is completely outside the city boundary and was not added.');
          } else {
            console.warn('Feature validation failed in review map');
          }
        }
      });
      map.on(L.Draw.Event.EDITED, () => {
        updateReviewFeaturesFromMap();
      });
      map.on(L.Draw.Event.DELETED, () => {
        updateReviewFeaturesFromMap();
      });
      reviewMapInstanceRef.current = map;
    };
    setTimeout(initializeReviewMap, 100);
    return () => {
      if (reviewMapInstanceRef.current) {
        reviewMapInstanceRef.current.remove();
        reviewMapInstanceRef.current = null;
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
    }
  }, [features, step, currentDomainColor, layerIcon, layerName, selectedDomain, isCustomLayer, customLayerIcon, customLayerName, createPopupContent]);

  // Update tile layer when mapView changes (Drawing Map)
useEffect(() => {  
  if (!mapInstanceRef.current || step !== 3 || dataSource !== 'draw') {
    return;
  }

  // Find and remove all existing tile layers
  const tileLayers = [];
  mapInstanceRef.current.eachLayer(layer => {
    if (layer instanceof L.TileLayer) {
      tileLayers.push(layer);
    }
  });
  
  tileLayers.forEach(layer => {
    mapInstanceRef.current.removeLayer(layer);
  });

  // Create and add new tile layer
  let newTileLayer;
  if (mapView === 'satellite') {
    newTileLayer = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: 'Tiles © Esri'
      }
    );
  } else {
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
}, [mapView, step, dataSource]);

// Update tile layer when mapView changes (Review Map)
useEffect(() => {  
  if (!reviewMapInstanceRef.current || step !== 4) {
    return;
  }

  // Find and remove all existing tile layers
  const tileLayers = [];
  reviewMapInstanceRef.current.eachLayer(layer => {
    if (layer instanceof L.TileLayer) {
      tileLayers.push(layer);
    }
  });
  
  tileLayers.forEach(layer => {
    reviewMapInstanceRef.current.removeLayer(layer);
  });

  // Create and add new tile layer
  let newTileLayer;
  if (mapView === 'satellite') {
    newTileLayer = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: 'Tiles © Esri'
      }
    );
  } else {
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
  
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
      });
  
      if (!response.ok) {
        throw new Error(`Overpass API error: ${response.statusText}`);
      }
  
      const data = await response.json();
  
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

  const splitMultiGeometries = (features) => {
    const splitFeatures = [];
    
    features.forEach((feature, index) => {
      if (!feature.geometry) {
        splitFeatures.push(feature);
        return;
      }
      
      if (feature.geometry.type === 'MultiPolygon') {
        // Split MultiPolygon into individual Polygons
        feature.geometry.coordinates.forEach((polygonCoords, polyIndex) => {
          splitFeatures.push({
            ...feature,
            geometry: {
              type: 'Polygon',
              coordinates: polygonCoords
            },
            properties: {
              ...feature.properties,
              name: feature.properties?.name 
                ? `${feature.properties.name} (Part ${polyIndex + 1})`
                : `Feature ${index + 1} (Part ${polyIndex + 1})`
            }
          });
        });
      } else if (feature.geometry.type === 'MultiLineString') {
        // Split MultiLineString into individual LineStrings
        feature.geometry.coordinates.forEach((lineCoords, lineIndex) => {
          splitFeatures.push({
            ...feature,
            geometry: {
              type: 'LineString',
              coordinates: lineCoords
            },
            properties: {
              ...feature.properties,
              name: feature.properties?.name 
                ? `${feature.properties.name} (Part ${lineIndex + 1})`
                : `Feature ${index + 1} (Part ${lineIndex + 1})`
            }
          });
        });
      } else {
        // Keep other geometry types as-is
        splitFeatures.push(feature);
      }
    });
    
    return splitFeatures;
  };

  useEffect(() => {
    // Only auto-select custom layer mode when NOT editing and no predefined layers are available
    if (selectedDomain && predefinedLayers.length === 0 && !isCustomLayer && !editingLayer) {
      setIsCustomLayer(true);
      setCustomLayerName('');
      setCustomLayerIcon(availableIcons[0]);
      setNameError('');
    }
  }, [selectedDomain, predefinedLayers, editingLayer, isCustomLayer, availableIcons]);

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
      // Step 1: Crop by boundary
      const boundaryFiltered = parsedFeatures
        .map(f => cropFeatureByBoundary(f, cityBoundary))
        .filter(f => f !== null);
      const croppedOutCount = parsedFeatures.length - boundaryFiltered.length;
      const splitFeatures = splitMultiGeometries(boundaryFiltered);

      if (splitFeatures.length === 0) {
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
      const combined = appendMode ? [...features, ...splitFeatures] : boundaryFiltered;

      // Step 3: Remove duplicates based on coordinates across all domains      
      // Build set of existing coordinates from all domains (excluding current layer if editing)
      const seenCoordinates = new Set();
      allFeaturesForCheck.forEach(feature => {
        if (!editingLayer || feature.properties?.layer_name !== finalLayerName) {
          const coordKey = getCoordinateKey(feature);
          if (coordKey) {
            seenCoordinates.add(coordKey);
          }
        }
      });
      
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
          return;
        }
        
        seenCoordinates.add(coordKey);
        uniqueFeatures.push(feature);
      });

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
    
    setIsProcessing(true);
    
    try {
      // Load all features across all domains for duplicate checking
      let allFeaturesForCheck = [];
      
      if (getAllFeatures && selectedCity) {
        try {
          allFeaturesForCheck = await getAllFeatures();
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
      
      // Build set of existing coordinates
      const seenCoordinates = new Set();
      const seenGeometries = new Set();
      
      allFeaturesForCheck.forEach(feature => {
        const isFromCurrentLayer = editingLayer && (
          feature.properties?.layer_name === finalLayerName ||
          feature.properties?.layer_name === originalLayerName
        );
        
        if (!isFromCurrentLayer) {
          const coordKey = getCoordinateKey(feature);
          if (coordKey) {
            seenCoordinates.add(coordKey);
          }
          
          const geomHash = getGeometryHash(feature.geometry);
          if (geomHash) {
            seenGeometries.add(geomHash);
          }
        }
      });
      
      // Filter out duplicates
      const uniqueFeatures = [];
      let coordinateDuplicates = 0;
      let geometryDuplicates = 0;
      
      features.forEach((feature, index) => {
        const coordKey = getCoordinateKey(feature);
        const geomHash = getGeometryHash(feature.geometry);
        
        if (!coordKey && !geomHash) {
          console.warn(`Could not extract coordinates or geometry from feature at index ${index}`);
          uniqueFeatures.push(feature);
          return;
        }
        
        if (coordKey && seenCoordinates.has(coordKey)) {
          coordinateDuplicates++;
          return;
        }
        
        if (geomHash && seenGeometries.has(geomHash)) {
          geometryDuplicates++;
          return;
        }
        
        if (coordKey) seenCoordinates.add(coordKey);
        if (geomHash) seenGeometries.add(geomHash);
        uniqueFeatures.push(feature);
      });
      
      const totalDuplicates = coordinateDuplicates + geometryDuplicates;
      
      if (totalDuplicates > 0) {
        const proceed = window.confirm(
          `${totalDuplicates} duplicate feature${totalDuplicates > 1 ? 's were' : ' was'} found:\n` +
          `- ${coordinateDuplicates} coordinate duplicate${coordinateDuplicates !== 1 ? 's' : ''}\n` +
          `- ${geometryDuplicates} geometry duplicate${geometryDuplicates !== 1 ? 's' : ''}\n\n` +
          `These features match existing features in OTHER layers across ALL domains.\n\n` +
          `Do you want to save only the ${uniqueFeatures.length} unique feature${uniqueFeatures.length !== 1 ? 's' : ''}?`
        );
        
        if (!proceed) {
          setIsProcessing(false);
          return;
        }
      }
      
      if (uniqueFeatures.length === 0) {
        alert('No unique features to save. All features are duplicates.');
        setIsProcessing(false);
        return;
      }
      
      const layerNameChanged = editingLayer && finalLayerName !== originalLayerName;
      const domainChanged = editingLayer && selectedDomain !== originalDomain;
      
      await onSave({
        name: finalLayerName,
        icon: finalLayerIcon,
        domain: selectedDomain,
        features: uniqueFeatures, 
        isEdit: !!editingLayer,
        layerNameChanged,
        domainChanged,
        originalName: originalLayerName,
        originalDomain: originalDomain
      });

      setIsProcessing(false);
    } catch (error) {
      console.error('Error saving layer:', error);
      alert(`Error saving layer: ${error.message}`);
      setIsProcessing(false);
    }
  };

  const handleClose = () => {
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
    setFeatures([]);
    setEditingFeatureName(null);
    setFeatureNameInput('');
    setNameError('');
    setIsCustomLayer(false);
    setCustomLayerName('');
    setCustomLayerIcon('fas fa-map-marker-alt');
    setAppendMode(true);
    setSelectedDomain(domain || '');
    setIsProcessing(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="modal-overlay">
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

          {/* Add this steps section */}
          <div className="modal-steps">
            <div className={`step ${step >= 1 ? 'active' : ''}`}>
              1. Layer Details
            </div>
            <div className={`step ${step >= 2 ? 'active' : ''}`}>
              2. Data Source
            </div>
            <div className={`step ${step >= 3 ? 'active' : ''}`}>
              3. Add & Review
            </div>
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
                    <div className="domain-dropdown-wrapper">
                      <button
                        className="domain-selector-btn"
                        onClick={() => {
                          setShowDomainDropdown(!showDomainDropdown);
                          if (!showDomainDropdown) setDomainSearchQuery('');
                        }}
                        type="button"
                      >
                        <div className="domain-selector-content">
                          {selectedDomain ? (
                            <>
                              <div
                                className="domain-icon-small"
                                style={{ backgroundColor: `${currentDomainColor}15` }}
                              >
                                <i
                                  className={domainIcons[selectedDomain]}
                                  style={{ color: currentDomainColor }}
                                />
                              </div>
                              <span>{formatDomainName(selectedDomain)}</span>
                            </>
                          ) : (
                            <span className="placeholder">Choose a domain...</span>
                          )}
                        </div>
                        <i className={`fas fa-chevron-${showDomainDropdown ? 'up' : 'down'}`}></i>
                      </button>
                      
                      {showDomainDropdown && (
                        <div className="domain-dropdown">
                          <div className="dropdown-search" style={{ padding: '8px', borderBottom: '1px solid #e2e8f0' }}>
                            <input
                              type="text"
                              placeholder="Search domains..."
                              value={domainSearchQuery}
                              onChange={(e) => setDomainSearchQuery(e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                width: '100%',
                                padding: '8px 12px',
                                border: '1px solid #e2e8f0',
                                borderRadius: '6px',
                                fontSize: '14px'
                              }}
                              autoFocus
                            />
                          </div>
                          {filteredAndSortedDomains.map(domainKey => (
                            <div
                              key={domainKey}
                              className={`domain-option ${selectedDomain === domainKey ? 'selected' : ''}`}
                              onClick={() => {
                                const oldDomain = selectedDomain;
                                const oldLayerName = isCustomLayer ? customLayerName : layerName;
                                
                                setSelectedDomain(domainKey);
                                setIsDomainChanged(editingLayer && oldDomain !== domainKey);
                                
                                // If editing and changing domain
                                if (editingLayer && oldDomain !== domainKey) {
                                  const newDomainLayers = layerDefs[domainKey] || [];
                                  const layerExistsInNewDomain = newDomainLayers.some(l => l.name === oldLayerName);
                                  
                                  if (layerExistsInNewDomain) {
                                    // Layer exists in new domain as predefined
                                    const foundLayer = newDomainLayers.find(l => l.name === oldLayerName);
                                    setIsCustomLayer(false);
                                    setLayerName(foundLayer.name);
                                    setLayerIcon(foundLayer.icon);
                                    setCustomLayerName('');
                                    setCustomLayerIcon('fas fa-map-marker-alt');
                                  } else {
                                    // Layer doesn't exist in new domain, keep as custom with same name and icon
                                    setIsCustomLayer(true);
                                    setCustomLayerName(oldLayerName);
                                    setCustomLayerIcon(isCustomLayer ? customLayerIcon : layerIcon);
                                    setLayerName('');
                                    setLayerIcon('fas fa-map-marker-alt');
                                  }
                                } else if (!editingLayer) {
                                  // If not editing, reset layer selection
                                  setLayerName('');
                                  setIsCustomLayer(false);
                                  setCustomLayerName('');
                                  setCustomLayerIcon('fas fa-map-marker-alt');
                                }
                                
                                setNameError('');
                                setShowDomainDropdown(false);
                                setDomainSearchQuery('');
                              }}
                            >
                              <div
                                className="domain-icon-small"
                                style={{ backgroundColor: `${domainColors[domainKey]}15` }}
                              >
                                <i
                                  className={domainIcons[domainKey]}
                                  style={{ color: domainColors[domainKey] }}
                                />
                              </div>
                              <span className="domain-text">{formatDomainName(domainKey)}</span>
                              {selectedDomain === domainKey && (
                                <i className="fas fa-check"></i>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  <small>Select the domain category for this layer</small>
                </div>
                {editingLayer && isDomainChanged && (
                  <div style={{ 
                    padding: '12px', 
                    background: '#fef3c7', 
                    border: '1px solid #fbbf24',
                    borderRadius: '8px',
                    marginTop: '12px'
                  }}>
                    <p style={{ margin: 0, color: '#92400e', fontSize: '14px' }}>
                      <i className="fas fa-info-circle" style={{ marginRight: '8px' }}></i>
                      Changing domain will move all features from <strong>{formatDomainName(originalDomain)}</strong> to <strong>{formatDomainName(selectedDomain)}</strong>
                    </p>
                  </div>
                )}
                {selectedDomain && (
                  <>
                    <div className="form-group">
                      <label>Select Layer *</label>
                      {predefinedLayers.length === 0 && !editingLayer ? (
                        <div style={{ 
                          padding: '16px', 
                          background: '#e0f2fe', 
                          border: '1px solid #0891b2',
                          borderRadius: '8px',
                          marginBottom: '12px'
                        }}>
                          <p style={{ margin: 0, color: '#075985', fontSize: '14px' }}>
                            <i className="fas fa-info-circle" style={{ marginRight: '8px' }}></i>
                            All predefined layers for this domain have been added. Creating a custom layer...
                          </p>
                        </div>
                      ) : (
                        <>
                          <div className="layer-dropdown-wrapper">
                            <button
                              className="layer-selector-btn"
                              onClick={() => {
                                setShowLayerDropdown(!showLayerDropdown);
                                if (!showLayerDropdown) setLayerSearchQuery('');
                              }}
                              type="button"
                            >
                              <div className="layer-selector-content">
                                {layerName || isCustomLayer ? (
                                  <>
                                    <div
                                      className="layer-icon-small"
                                      style={{ backgroundColor: `${currentDomainColor}15` }}
                                    >
                                      <i
                                        className={isCustomLayer ? customLayerIcon : layerIcon}
                                        style={{ color: currentDomainColor }}
                                      />
                                    </div>
                                    <span>
                                      {isCustomLayer 
                                        ? 'Custom Layer'
                                        : layerName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
                                      }
                                    </span>
                                  </>
                                ) : (
                                  <span className="placeholder">Choose a layer...</span>
                                )}
                              </div>
                              <i className={`fas fa-chevron-${showLayerDropdown ? 'up' : 'down'}`}></i>
                            </button>
                            
                            {showLayerDropdown && (
                              <div className="layer-dropdown">
                                <div className="dropdown-search" style={{ padding: '8px', borderBottom: '1px solid #e2e8f0' }}>
                                  <input
                                    type="text"
                                    placeholder="Search layers..."
                                    value={layerSearchQuery}
                                    onChange={(e) => setLayerSearchQuery(e.target.value)}
                                    onClick={(e) => e.stopPropagation()}
                                    style={{
                                      width: '100%',
                                      padding: '8px 12px',
                                      border: '1px solid #e2e8f0',
                                      borderRadius: '6px',
                                      fontSize: '14px'
                                    }}
                                    autoFocus
                                  />
                                </div>
                                {filteredLayers.map(layer => (
                                  <div
                                    key={layer.name}
                                    className={`layer-option ${layerName === layer.name ? 'selected' : ''}`}
                                    onClick={() => {
                                      handleLayerSelection({ target: { value: layer.name } });
                                      setShowLayerDropdown(false);
                                      setLayerSearchQuery('');
                                    }}
                                  >
                                    <div
                                      className="layer-icon-small"
                                      style={{ backgroundColor: `${currentDomainColor}15` }}
                                    >
                                      <i
                                        className={layer.icon}
                                        style={{ color: currentDomainColor }}
                                      />
                                    </div>
                                    <span className="layer-text">
                                      {layer.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                                    </span>
                                    {layerName === layer.name && (
                                      <i className="fas fa-check"></i>
                                    )}
                                  </div>
                                ))}
                                <div
                                  className="layer-option custom-option"
                                  onClick={() => {
                                    handleLayerSelection({ target: { value: 'custom' } });
                                    setShowLayerDropdown(false);
                                    setLayerSearchQuery('');
                                  }}
                                >
                                  <div className="layer-icon-small">
                                    <i className="fas fa-plus" style={{ color: '#0891b2' }} />
                                  </div>
                                  <span className="layer-text">Add Custom Layer</span>
                                </div>
                              </div>
                            )}
                          </div>
                          <small>Select a predefined layer or create a custom one</small>
                        </>
                      )}
                    </div>
                    {(isCustomLayer || (predefinedLayers.length === 0 && !editingLayer)) && (
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
                        {editingLayer && customLayerName !== originalLayerName && customLayerName && (
                          <div style={{ 
                            padding: '8px 12px', 
                            background: '#dbeafe', 
                            border: '1px solid #3b82f6',
                            borderRadius: '6px',
                            marginBottom: '12px'
                          }}>
                            <small style={{ color: '#1e40af', margin: 0 }}>
                              <i className="fas fa-arrow-right" style={{ marginRight: '8px' }}></i>
                              Layer will be renamed from "<strong>{originalLayerName}</strong>" to "<strong>{customLayerName}</strong>"
                            </small>
                          </div>
                        )}
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
                  </>
                )}
                <div className="form-actions">
                <button
                  className="btn-primary"
                  onClick={() => {
                    // Double-check before proceeding
                    const finalLayerName = isCustomLayer ? customLayerName : layerName;
                    const finalLayerIcon = isCustomLayer ? customLayerIcon : layerIcon;
                    const validationError = validateLayerName(finalLayerName);
                    
                    if (validationError) {
                      setNameError(validationError);
                      alert(validationError);
                      return;
                    }
                    
                    // Validate icon is selected
                    if (!finalLayerIcon) {
                      alert('Please select an icon for the layer');
                      return;
                    }
                    
                    // Always go to step 2 (data source selection)
                    setStep(2);
                  }}
                  disabled={
                    !selectedDomain || 
                    (isCustomLayer ? (!customLayerName || !!nameError || !customLayerIcon) : !layerName)
                  }
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
                    <i className="fas fa-arrow-left"></i> Previous
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
                    <i className="fas fa-arrow-left"></i> Previous
                  </button>
                  {dataSource === 'draw' && (
                    <button
                      className="btn-primary"
                      onClick={handleSave}
                      disabled={features.length === 0 || isProcessing}
                    >
                      {isProcessing ? (
                        <>
                          <i className="fas fa-spinner fa-spin"></i>
                          {editingLayer ? 'Updating...' : 'Saving...'}
                        </>
                      ) : (
                        <>
                          <i className="fas fa-check"></i>
                          {editingLayer ? 'Update' : 'Save'}
                        </>
                      )}
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
                      }
                      setDataSource('upload');
                      setStep(3);
                    }}
                  >
                    <i className="fas fa-arrow-left"></i> Previous
                  </button>
                  <button
                    className="btn-primary"
                    onClick={handleSave}
                    disabled={features.length === 0}
                  >
                    <i className="fas fa-save"></i> Save
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
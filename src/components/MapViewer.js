import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import 'leaflet.markercluster';
import '../styles/MapViewer.css';
import * as turf from '@turf/turf';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Layer icon mapping for predefined layers
const layerIcons = {
  roads: 'fas fa-road',
  sidewalks: 'fas fa-walking',
  parking: 'fas fa-parking',
  transit_stops: 'fas fa-bus',
  subways: 'fas fa-subway',
  railways: 'fas fa-train',
  airports: 'fas fa-plane',
  bicycle_parking: 'fas fa-bicycle',
  police: 'fas fa-shield-alt',
  government_offices: 'fas fa-landmark',
  fire_stations: 'fas fa-fire-extinguisher',
  hospitals: 'fas fa-hospital',
  doctor_offices: 'fas fa-user-md',
  dentists: 'fas fa-tooth',
  clinics: 'fas fa-clinic-medical',
  pharmacies: 'fas fa-pills',
  acupuncture: 'fas fa-hand-holding-heart',
  factories: 'fas fa-industry',
  banks: 'fas fa-university',
  shops: 'fas fa-store',
  restaurants: 'fas fa-utensils',
  parks: 'fas fa-tree',
  open_green_spaces: 'fas fa-leaf',
  nature: 'fas fa-mountain',
  waterways: 'fas fa-water',
  lakes: 'fas fa-tint',
  tourist_attractions: 'fas fa-camera',
  theme_parks: 'fas fa-ticket',
  gyms: 'fas fa-dumbbell',
  theatres: 'fas fa-theater-masks',
  stadiums: 'fas fa-futbol',
  places_of_worship: 'fas fa-pray',
  schools: 'fas fa-school',
  universities: 'fas fa-university',
  colleges: 'fas fa-graduation-cap',
  libraries: 'fas fa-book',
  houses: 'fas fa-home',
  apartments: 'fas fa-building',
  bars: 'fas fa-wine-glass-alt',
  cafes: 'fas fa-coffee',
  leisure_facilities: 'fas fa-dice',
};

// Helper function to calculate true centroid of geometry
const calculateCentroid = (geometry) => {
  try {
    if (geometry.type === 'Point') {
      return { lat: geometry.coordinates[1], lng: geometry.coordinates[0] };
    }

    let totalLat = 0;
    let totalLng = 0;
    let pointCount = 0;

    const processCoordinates = (coords, depth = 0) => {
      if (Array.isArray(coords[0])) {
        coords.forEach(c => processCoordinates(c, depth + 1));
      } else {
        // This is a coordinate pair [lng, lat]
        totalLng += coords[0];
        totalLat += coords[1];
        pointCount++;
      }
    };

    if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
      processCoordinates(geometry.coordinates);
    } else if (geometry.type === 'LineString' || geometry.type === 'MultiLineString') {
      processCoordinates(geometry.coordinates);
    }

    if (pointCount === 0) {
      // Fallback to Leaflet's bounds method
      const tempLayer = L.geoJSON(geometry);
      const bounds = tempLayer.getBounds();
      return bounds.getCenter();
    }

    return {
      lat: totalLat / pointCount,
      lng: totalLng / pointCount
    };
  } catch (error) {
    console.warn('Error calculating centroid:', error);
    // Fallback to Leaflet's bounds method
    const tempLayer = L.geoJSON(geometry);
    const bounds = tempLayer.getBounds();
    return bounds.getCenter();
  }
};

const getNeighbourhoodForPoint = (lat, lng, neighbourhoods, neighbourhoodNames) => {
  if (!neighbourhoods || !Array.isArray(neighbourhoods)) {
    return null;
  }
  
  try {
    const point = turf.point([lng, lat]);
    const matchingNeighbourhoods = [];
    
    for (let i = 0; i < neighbourhoods.length; i++) {
      const neighbourhood = neighbourhoods[i];
      const neighbourhoodFeature = {
        type: 'Feature',
        geometry: neighbourhood,
        properties: {}
      };
      
      // Check if point is within this neighbourhood
      if (turf.booleanPointInPolygon(point, neighbourhoodFeature)) {
        matchingNeighbourhoods.push(neighbourhoodNames[i] || `Neighbourhood ${i + 1}`);
      }
    }
    
    // Return all matching neighbourhoods, or null if none found
    if (matchingNeighbourhoods.length === 0) {
      return null;
    } else if (matchingNeighbourhoods.length === 1) {
      return matchingNeighbourhoods[0];
    } else {
      return matchingNeighbourhoods.join(', ');
    }
  } catch (error) {
    console.warn('Error checking neighbourhood:', error);
    return null;
  }
};

const MapViewer = ({
  selectedCity,
  activeLayers = {},
  domainColors = {},
  loadCityFeatures,
  availableLayers = {},
  mapView = 'street',
  cities = [],
  onCitySelect = () => {},
  processingProgress = {},
  dataSource = 'osm',
  showNeighbourhoods = false
}) => {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const tileLayerRef = useRef(null);
  const clusterGroupsRef = useRef({});
  const boundaryLayerRef = useRef(null);
  const nonPointLayerRef = useRef(null);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [featureCount, setFeatureCount] = useState(0);
  const loadFeaturesTimeoutRef = useRef(null);
  const cityMarkersLayerRef = useRef(null);
  const abortControllerRef = useRef(null);
  const isLoadingRef = useRef(false);
  const displayedGeometriesRef = useRef(new Map());
  const previousActiveLayersRef = useRef(new Set());
  const activeLayerNames = useMemo(() => {
    return Object.keys(activeLayers).filter(layer => activeLayers[layer]);
  }, [activeLayers]);
  const loadedLayersRef = useRef(new Set());
  const neighbourhoodLayersRef = useRef(null);

  const boundaryHash = useMemo(() => {
    if (!selectedCity?.boundary) return null;
    // Use boundary length and a sample of content to create a unique identifier
    const boundary = selectedCity.boundary;
    return `${selectedCity.name}-${boundary.length}-${boundary.substring(0, 50)}-${boundary.substring(boundary.length - 50)}`;
  }, [selectedCity?.boundary, selectedCity?.name]);

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;
    
    const map = L.map(mapRef.current, {
      zoomControl: true,
      minZoom: 2,
      maxZoom: 18
    }).setView([20, 0], 2);

    // Add initial tile layer (street view by default)
    const tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(map);
    
    tileLayerRef.current = tileLayer;
    mapInstanceRef.current = map;

    // Custom Zoom to Boundary Control
    const ZoomToBoundaryControl = L.Control.extend({
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
          const cityLat = parseFloat(mapContainer.dataset.cityLat);
          const cityLng = parseFloat(mapContainer.dataset.cityLng);
          
          // If no city selected, zoom to world view
          if (isNaN(cityLat) || isNaN(cityLng)) {
            map.setView([20, 0], 2);
            return;
          }
          
          // Try boundary first if city is selected
          if (boundaryLayerRef.current) {
            try {
              const bounds = boundaryLayerRef.current.getBounds();
              if (bounds.isValid()) {
                map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
                return;
              }
            } catch (error) {
              console.warn('Error fitting to boundary:', error);
            }
          }
          
          // Fallback: zoom to city coordinates
          map.setView([cityLat, cityLng], 12);
        };
  
        return container;
      }
    });
  
    const zoomControl = new ZoomToBoundaryControl();
    map.addControl(zoomControl);

    const resizeObserver = new ResizeObserver(() => {
      if (mapInstanceRef.current) {
        setTimeout(() => {
          if (mapInstanceRef.current) {
            mapInstanceRef.current.invalidateSize();
          }
        }, 350);
      }
    });

    if (mapRef.current) {
      resizeObserver.observe(mapRef.current);
    }

    return () => {
      resizeObserver.disconnect();
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
      if (loadFeaturesTimeoutRef.current) {
        clearTimeout(loadFeaturesTimeoutRef.current);
        loadFeaturesTimeoutRef.current = null;
      }
    };
  }, []);

  // Toggle zoom-to-boundary button visibility based on city selection
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    const controlContainers = mapInstanceRef.current.getContainer().querySelectorAll('.leaflet-control-custom');
    controlContainers.forEach(container => {
      container.style.display = selectedCity ? 'flex' : 'none';
    });
  }, [selectedCity]);

  // Update tile layer when mapView changes
  useEffect(() => {
    if (!mapInstanceRef.current || !tileLayerRef.current) {
      return;
    }

    // Remove current tile layer
    mapInstanceRef.current.removeLayer(tileLayerRef.current);

    // Create and add new tile layer
    let newTileLayer;
    if (mapView === 'satellite') {
      newTileLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles © Esri'
      });
    } else {
      newTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      });
    }
    
    newTileLayer.addTo(mapInstanceRef.current);
    tileLayerRef.current = newTileLayer;

    // Force tile layer to back
    newTileLayer.bringToBack();

    // Re-add all overlays after a short delay
    setTimeout(() => {      
      // Re-add cluster groups
      Object.entries(clusterGroupsRef.current).forEach(([layerName, clusterGroup]) => {
        if (clusterGroup) {
          
          if (mapInstanceRef.current.hasLayer(clusterGroup)) {
            mapInstanceRef.current.removeLayer(clusterGroup);
          }
          
          clusterGroup.addTo(mapInstanceRef.current);
          
          if (typeof clusterGroup.refreshClusters === 'function') {
            clusterGroup.refreshClusters();
          }
        }
      });

      // Re-add boundary layer
      if (boundaryLayerRef.current) {
        if (mapInstanceRef.current.hasLayer(boundaryLayerRef.current)) {
          mapInstanceRef.current.removeLayer(boundaryLayerRef.current);
        }
        boundaryLayerRef.current.addTo(mapInstanceRef.current);
        boundaryLayerRef.current.bringToFront();
      }

      // Re-add non-point layer
      if (nonPointLayerRef.current) {
        if (mapInstanceRef.current.hasLayer(nonPointLayerRef.current)) {
          mapInstanceRef.current.removeLayer(nonPointLayerRef.current);
        }
        nonPointLayerRef.current.addTo(mapInstanceRef.current);
        nonPointLayerRef.current.bringToFront();
      }

      // Force map repaint
      mapInstanceRef.current.invalidateSize();
      
      // Bring tile layer to back one more time
      newTileLayer.bringToBack();
    }, 200);
  }, [mapView]);

  const markLayerAsLoaded = useCallback((layerName) => {
    loadedLayersRef.current = new Set([...loadedLayersRef.current, layerName]);
  }, []);

  const displayCityMarkers = useCallback(() => {
    if (!mapInstanceRef.current) return;
  
    // Remove existing city markers
    if (cityMarkersLayerRef.current && mapInstanceRef.current.hasLayer(cityMarkersLayerRef.current)) {
      mapInstanceRef.current.removeLayer(cityMarkersLayerRef.current);
      cityMarkersLayerRef.current = null;
    }
  
    // Only show city markers when no city is selected
    if (selectedCity || cities.length === 0) return;
  
    const cityMarkersGroup = L.layerGroup();
  
    cities.forEach(city => {
      // Check if city is currently processing using the correct processing key
      const processingKey = `${city.name}@${dataSource}`;
      const progress = processingProgress?.[processingKey];
      const isProcessing = progress && progress.status === 'processing' && progress.dataSource === dataSource;
      
      try {
        let markerLat, markerLng;
  
        // Try to get centroid from boundary first
        if (city.boundary) {
          const boundary = JSON.parse(city.boundary);
          const centroid = calculateCentroid(boundary);
          markerLat = centroid.lat;
          markerLng = centroid.lng;
        } else if (city.latitude && city.longitude) {
          // Fallback to city coordinates
          markerLat = city.latitude;
          markerLng = city.longitude;
        } else {
          console.warn(`MapViewer: No location data for city ${city.name}`);
          return;
        }
  
        // Create custom icon for city
        const cityIcon = L.divIcon({
          className: 'city-marker-icon',
          html: `
            <div class="city-icon-wrapper" style="
              background-color: ${city.hasDataLayers ? '#0891b2' : isProcessing ? '#94a3b8' : '#cbd5e1'};
              width: 32px;
              height: 32px;
              border-radius: 50%;
              border: 3px solid white;
              box-shadow: 0 3px 8px rgba(0,0,0,0.4);
              display: flex;
              align-items: center;
              justify-content: center;
              color: ${city.hasDataLayers || isProcessing ? 'white' : '#64748b'};
              font-size: 14px;
              cursor: ${isProcessing ? 'not-allowed' : 'pointer'};
              transition: all 0.2s;
              opacity: ${isProcessing ? '0.6' : '1'};
            ">
              <i class="fas ${isProcessing ? 'fa-spinner fa-spin' : city.hasDataLayers ? 'fa-city' : 'fa-clock'}"></i>
            </div>
          `,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
          popupAnchor: [0, -16]
        });
  
        const marker = L.marker([markerLat, markerLng], {
          icon: cityIcon,
          zIndexOffset: 2000
        });
  
        // Parse city name for display
        const parsedName = city.name.split(',').map(p => p.trim());
        const cityName = parsedName[0];
        const province = parsedName[1] || '';
        const country = parsedName[2] || parsedName[1] || '';
  
        // Create tooltip content
        let tooltipContent = `<strong>${cityName}</strong>`;
        if (province && country) {
          tooltipContent += `<br/>${province}, ${country}`;
        } else if (country) {
          tooltipContent += `<br/>${country}`;
        }
        if (city.population) {
          tooltipContent += `<br/>Pop: ${city.population.toLocaleString()}`;
        }
        if (city.size) {
          tooltipContent += `<br/>Area: ${city.size} km²`;
        }
  
        // Bind tooltip
        marker.bindTooltip(tooltipContent, {
          permanent: false,
          direction: 'top',
          offset: [0, -20],
          opacity: 0.95,
          className: 'city-marker-tooltip'
        });
  
        // Add hover effect
        if (!isProcessing) {
          marker.on('mouseover', function(e) {
            mapInstanceRef.current.eachLayer((mapLayer) => {
              if (mapLayer.getTooltip && mapLayer.getTooltip() && mapLayer.isTooltipOpen()) {
                mapLayer.closeTooltip();
              }
              if (mapLayer.getAllChildMarkers) {
                mapLayer.getAllChildMarkers().forEach((m) => {
                  if (m.getTooltip && m.getTooltip() && m.isTooltipOpen()) {
                    m.closeTooltip();
                  }
                });
              }
            });
            
            const innerDiv = this._icon?.querySelector('.city-icon-wrapper');
            if (innerDiv) {
              innerDiv.style.transform = 'scale(1.15)';
              if (city.hasDataLayers) {
                innerDiv.style.backgroundColor = '#0e7490';
              } else {
                innerDiv.style.backgroundColor = '#94a3b8';
              }
            }
          });
        
          marker.on('mouseout', function(e) {
            const innerDiv = this._icon?.querySelector('.city-icon-wrapper');
            if (innerDiv) {
              innerDiv.style.transform = 'scale(1)';
              if (city.hasDataLayers) {
                innerDiv.style.backgroundColor = '#0891b2';
              } else {
                innerDiv.style.backgroundColor = '#cbd5e1';
              }
            }
          });
        }
  
        // Click handler to select city
        marker.on('click', function(e) {
          if (isProcessing) {
            return;
          }
          onCitySelect(city);
        });
  
        cityMarkersGroup.addLayer(marker);
      } catch (error) {
        console.warn(`MapViewer: Error creating marker for city ${city.name}:`, error);
      }
    });
  
    if (cityMarkersGroup.getLayers().length > 0) {
      cityMarkersGroup.addTo(mapInstanceRef.current);
      cityMarkersLayerRef.current = cityMarkersGroup;
    }
  }, [cities, selectedCity, onCitySelect, processingProgress, dataSource]);

  useEffect(() => {
    if (!mapInstanceRef.current || !selectedCity) return;
    
    // Remove existing neighbourhood layers
    if (neighbourhoodLayersRef.current) {
      neighbourhoodLayersRef.current.eachLayer((layer) => {
        mapInstanceRef.current.removeLayer(layer);
      });
      neighbourhoodLayersRef.current = null;
    }
    
    // Add neighbourhood layers if enabled and available
    if (showNeighbourhoods && selectedCity.neighbourhoods) {
      try {
        const neighbourhoods = JSON.parse(selectedCity.neighbourhoods);
        
        if (neighbourhoods && neighbourhoods.length > 0) {
          const neighbourhoodGroup = L.layerGroup();
          
          neighbourhoods.forEach((neighbourhood, index) => {
            try {
              const feature = {
                type: 'Feature',
                geometry: neighbourhood,
                properties: {}
              };
              
              // Create GeoJSON layer with dotted boundary style
              const geoJsonLayer = L.geoJSON(feature, {
                style: {
                  color: '#06b6d4',
                  weight: 2,
                  fillOpacity: 0,
                  dashArray: '5, 5',
                  interactive: false
                },
                pane: 'overlayPane',
              });
              
              // Add to group
              geoJsonLayer.eachLayer((layer) => {
                neighbourhoodGroup.addLayer(layer);
              });
              
            } catch (error) {
              console.error(`Error rendering neighbourhood ${index}:`, error);
            }
          });
          
          neighbourhoodGroup.addTo(mapInstanceRef.current);
          neighbourhoodLayersRef.current = neighbourhoodGroup;
          
          // IMPORTANT: Bring neighbourhood layers to front after adding
          setTimeout(() => {
            if (neighbourhoodLayersRef.current) {
              neighbourhoodLayersRef.current.eachLayer((layer) => {
                if (layer.bringToFront) {
                  layer.bringToFront();
                }
              });
            }
            
            // Keep tile layer at back
            if (tileLayerRef.current) {
              tileLayerRef.current.bringToBack();
            }
            
            // Keep boundary below neighbourhoods if it exists
            if (boundaryLayerRef.current) {
              boundaryLayerRef.current.bringToBack();
              if (tileLayerRef.current) {
                tileLayerRef.current.bringToBack();
              }
            }
          }, 100);
        }
      } catch (error) {
        console.error('Error parsing neighbourhoods:', error);
      }
    }
  }, [showNeighbourhoods, selectedCity]);

  useEffect(() => {
    displayCityMarkers();
  }, [displayCityMarkers]);

  // Clear all markers and layers
  const clearAllLayers = useCallback(() => {
    if (!mapInstanceRef.current || !mapInstanceRef.current.getContainer()) {
      return;
    }
    if (!mapInstanceRef.current) return;
  
    // Clear displayed geometries first
    displayedGeometriesRef.current.forEach((geomInfo) => {
      if (geomInfo.layer && mapInstanceRef.current.hasLayer(geomInfo.layer)) {
        mapInstanceRef.current.removeLayer(geomInfo.layer);
      }
      if (geomInfo.marker) {
        geomInfo.marker.geometryLayer = null;
      }
    });
    displayedGeometriesRef.current.clear();
  
    Object.entries(clusterGroupsRef.current).forEach(([layerName, clusterGroup]) => {
      if (clusterGroup && mapInstanceRef.current.hasLayer(clusterGroup)) {
        mapInstanceRef.current.removeLayer(clusterGroup);
      }
    });
    clusterGroupsRef.current = {};
  
    if (boundaryLayerRef.current && mapInstanceRef.current.hasLayer(boundaryLayerRef.current)) {
      mapInstanceRef.current.removeLayer(boundaryLayerRef.current);
      boundaryLayerRef.current = null;
    }
  
    if (nonPointLayerRef.current && mapInstanceRef.current.hasLayer(nonPointLayerRef.current)) {
      mapInstanceRef.current.removeLayer(nonPointLayerRef.current);
      nonPointLayerRef.current = null;
    }
  
    if (cityMarkersLayerRef.current && mapInstanceRef.current.hasLayer(cityMarkersLayerRef.current)) {
      mapInstanceRef.current.removeLayer(cityMarkersLayerRef.current);
      cityMarkersLayerRef.current = null;
    }
  
    setFeatureCount(0);
    loadedLayersRef.current = new Set();
  }, []);

  const loadLayerIncremental = useCallback(async (layerName) => {
    if (!selectedCity || loadedLayersRef.current.has(layerName) || !loadCityFeatures) {
      return;
    }
    
    try {
      const singleLayerActive = { [layerName]: true };
      const features = await loadCityFeatures(selectedCity.name, singleLayerActive);
      
      if (features.length === 0) {
        markLayerAsLoaded(layerName);
        return;
      }
      
      // Parse neighbourhoods if showNeighbourhoods is enabled
      let parsedNeighbourhoods = null;
      let parsedNeighbourhoodNames = null;
  
      if (showNeighbourhoods && selectedCity?.neighbourhoods) {
        try {
          parsedNeighbourhoods = JSON.parse(selectedCity.neighbourhoods);
          parsedNeighbourhoodNames = selectedCity.neighbourhood_names 
            ? JSON.parse(selectedCity.neighbourhood_names)
            : [];
        } catch (error) {
          console.warn('Error parsing neighbourhoods:', error);
        }
      }
      
      // Create global cluster group if it doesn't exist
      if (!clusterGroupsRef.current['__global__']) {        
        const globalClusterGroup = L.markerClusterGroup({
          maxClusterRadius: 80,
          spiderfyOnMaxZoom: true,
          showCoverageOnHover: false,
          zoomToBoundsOnClick: true,
          spiderfyDistanceMultiplier: 1.5,
          iconCreateFunction: function(cluster) {
            const count = cluster.getChildCount();
            const markers = cluster.getAllChildMarkers();
            
            // Count domains and neighbourhoods in this cluster
            const domainCounts = {};
            const neighbourhoodSet = new Set();
            markers.forEach(marker => {
              const domain = marker.options.domainName;
              const neighbourhood = marker.options.neighbourhoodName;
              if (domain) {
                domainCounts[domain] = (domainCounts[domain] || 0) + 1;
              }
              if (neighbourhood) {
                neighbourhoodSet.add(neighbourhood);
              }
            });
            
            const domains = Object.keys(domainCounts);
            
            // If single domain, use solid color
            if (domains.length === 1) {
              const domainColor = domainColors[domains[0]] || '#666666';
              return L.divIcon({
                html: `<div style="background-color: ${domainColor}; width: 40px; height: 40px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 14px; box-sizing: border-box;">${count}</div>`,
                className: 'custom-cluster-icon',
                iconSize: L.point(40, 40),
                iconAnchor: L.point(20, 20)
              });
            }
            
            // Multiple domains - create pie chart
            const total = count;
            let currentAngle = 0;
            const slices = [];
            
            domains.forEach(domain => {
              const domainCount = domainCounts[domain];
              const percentage = domainCount / total;
              const angle = percentage * 360;
              const color = domainColors[domain] || '#666666';
              
              slices.push({
                color,
                startAngle: currentAngle,
                endAngle: currentAngle + angle,
                percentage
              });
              
              currentAngle += angle;
            });
            
            // Generate conic-gradient for pie chart
            const gradientStops = [];
            slices.forEach((slice, index) => {
              gradientStops.push(`${slice.color} ${slice.startAngle}deg ${slice.endAngle}deg`);
            });
            
            const gradient = `conic-gradient(${gradientStops.join(', ')})`;
            
            return L.divIcon({
              html: `<div style="background: ${gradient}; width: 40px; height: 40px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; box-sizing: border-box;">
                <div style="background: white; width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #374151; font-weight: bold; font-size: 12px;">${count}</div>
              </div>`,
              className: 'custom-cluster-icon',
              iconSize: L.point(40, 40),
              iconAnchor: L.point(20, 20)
            });
          },
          chunkedLoading: true,
          chunkInterval: 200,
          chunkDelay: 50
        });
        
        // Add event handlers for spiderfied state
        globalClusterGroup.on('spiderfied', function(e) {
          const cluster = e.cluster;
          const markers = e.markers;
          
          markers.forEach((marker, index) => {
            if (marker._icon) {
              marker._icon.style.zIndex = 10000 + index;
            }
          });
          
          if (cluster._icon) {
            cluster._icon.style.opacity = '0.3';
            cluster._icon.style.transition = 'opacity 0.3s';
          }
        });

        globalClusterGroup.on('unspiderfied', function(e) {
          const cluster = e.cluster;
          if (cluster._icon) {
            cluster._icon.style.opacity = '1';
          }
        });

        globalClusterGroup.on('clustermouseover', function(e) {
          // Close ALL tooltips on the map
          mapInstanceRef.current.eachLayer((mapLayer) => {
            if (mapLayer.getTooltip && mapLayer.getTooltip() && mapLayer.isTooltipOpen()) {
              mapLayer.closeTooltip();
            }
            if (mapLayer.getAllChildMarkers) {
              mapLayer.getAllChildMarkers().forEach((m) => {
                if (m.getTooltip && m.getTooltip() && m.isTooltipOpen()) {
                  m.closeTooltip();
                }
              });
            }
          });
          
          const cluster = e.layer;
          const markers = cluster.getAllChildMarkers();
          
          const domainCounts = {};
          const neighbourhoodSet = new Set();
          markers.forEach(marker => {
            const domain = marker.options.domainName;
            const neighbourhood = marker.options.neighbourhoodName;
            if (domain) {
              domainCounts[domain] = (domainCounts[domain] || 0) + 1;
            }
            if (neighbourhood) {
              neighbourhoodSet.add(neighbourhood);
            }
          });
          
          const neighbourhoods = Array.from(neighbourhoodSet);
          
          let tooltipContent = `<strong>${markers.length} features</strong>`;
          
          if (Object.keys(domainCounts).length > 1) {
            tooltipContent += '<div class="domain-breakdown">';
            Object.entries(domainCounts)
              .sort((a, b) => b[1] - a[1])
              .forEach(([domain, count]) => {
                const color = domainColors[domain] || '#666666';
                const domainName = domain.charAt(0).toUpperCase() + domain.slice(1);
                tooltipContent += `
                  <div class="domain-item">
                    <div class="domain-color" style="background-color: ${color}"></div>
                    <span>${domainName}: ${count}</span>
                  </div>
                `;
              });
            tooltipContent += '</div>';
          }
          
          // Show neighbourhood(s) if available
          if (neighbourhoods.length > 0) {
            tooltipContent += `<div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #e2e8f0;">`;
            tooltipContent += `<strong style="color: #0891b2; font-size: 12px; display: block; margin-bottom: 4px;">Neighbourhood${neighbourhoods.length > 1 ? 's' : ''} (${neighbourhoods.length}):</strong>`;
            
            // Crop neighbourhood list to approximately 2 lines
            const neighbourhoodText = neighbourhoods.join(', ');
            const maxLength = 30; // Approximate character limit for 2 lines
            
            let displayText;
            if (neighbourhoodText.length <= maxLength) {
              displayText = neighbourhoodText;
            } else {
              // Crop at the last complete neighbourhood name before the limit
              const croppedText = neighbourhoodText.substring(0, maxLength);
              const lastCommaIndex = croppedText.lastIndexOf(',');
              
              if (lastCommaIndex > 0) {
                displayText = croppedText.substring(0, lastCommaIndex) + ', etc.';
              } else {
                displayText = croppedText + '...';
              }
            }
            
            tooltipContent += `<span style="font-size: 12px; display: block; word-wrap: break-word; white-space: normal; line-height: 1.4;">${displayText}</span>`;
            tooltipContent += `</div>`;
          }
          
          cluster.bindTooltip(tooltipContent, {
            permanent: false,
            direction: 'top',
            offset: [0, -20],
            opacity: 0.95,
            className: 'cluster-tooltip'
          }).openTooltip();
        });

        globalClusterGroup.on('clustermouseout', function(e) {
          e.layer.closeTooltip();
        });
        
        clusterGroupsRef.current['__global__'] = globalClusterGroup;
        globalClusterGroup.addTo(mapInstanceRef.current);
      }
      
      const globalClusterGroup = clusterGroupsRef.current['__global__'];
      
      if (!globalClusterGroup) {
        console.warn('No global cluster group available');
        return;
      }
      
      const safeAvailableLayers = availableLayers || {};
      let addedCount = 0;
      
      // Process features in chunks to keep UI responsive
      const CHUNK_SIZE = 50; // Process 50 features at a time
      const markersToAdd = [];
      
      for (const feature of features) {
        try {
          if (!feature.geometry || !feature.geometry.type || !feature.geometry.coordinates) {
            continue;
          }
          
          const { feature_name, domain_name } = feature.properties;
          const domainColor = domainColors[domain_name] || '#666666';
          const iconClass = safeAvailableLayers[layerName]?.icon || layerIcons[layerName] || 'fas fa-map-marker-alt';
          
          if (feature.geometry.type === 'Point') {
            const [lon, lat] = feature.geometry.coordinates;
            
            if (isNaN(lon) || isNaN(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) {
              continue;
            }
            
            const customIcon = L.divIcon({
              className: 'custom-marker-icon',
              html: `
                <div style="
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
                  <i class="${iconClass}"></i>
                </div>
              `,
              iconSize: [28, 28],
              popupAnchor: [0, -14],
              domainColor: domainColor
            });
            
            // Get neighbourhood for this point
            const neighbourhoodName = parsedNeighbourhoods 
              ? getNeighbourhoodForPoint(lat, lon, parsedNeighbourhoods, parsedNeighbourhoodNames)
              : null;
            
            const marker = L.marker([lat, lon], {
              icon: customIcon,
              zIndexOffset: 1000,
              domainName: domain_name,
              layerName: layerName,
              neighbourhoodName: neighbourhoodName
            });
            
            marker.on('mouseover', function(e) {
              // Close ALL tooltips on the map
              mapInstanceRef.current.eachLayer((mapLayer) => {
                if (mapLayer.getTooltip && mapLayer.getTooltip() && mapLayer.isTooltipOpen()) {
                  mapLayer.closeTooltip();
                }
                if (mapLayer.getAllChildMarkers) {
                  mapLayer.getAllChildMarkers().forEach((m) => {
                    if (m.getTooltip && m.getTooltip() && m.isTooltipOpen()) {
                      m.closeTooltip();
                    }
                  });
                }
              });
            });
            
            marker.bindTooltip(`
              <div style="font-family: Inter, sans-serif;">
                <h4 style="margin: 0 0 8px 0; color: #1a202c; font-size: 14px;">
                  ${feature_name || 'Unnamed Feature'}
                </h4>
                <p style="margin: 0; color: #64748b; font-size: 12px;">
                  <strong>Layer:</strong> ${layerName}<br>
                  <strong>Domain:</strong> ${domain_name}
                  ${neighbourhoodName ? `<br><strong>Neighbourhood:</strong> ${neighbourhoodName}` : ''}
                </p>
              </div>
            `, {
              permanent: false,
              direction: 'top',
              offset: [0, -20],
              opacity: 0.95,
              className: 'feature-marker-tooltip'
            });
            
            markersToAdd.push(marker);
          } else {
            // Handle non-point geometries
            try {
              const centroid = calculateCentroid(feature.geometry);
              
              // Get neighbourhood for this centroid
              const neighbourhoodName = parsedNeighbourhoods 
                ? getNeighbourhoodForPoint(centroid.lat, centroid.lng, parsedNeighbourhoods, parsedNeighbourhoodNames)
                : null;
              
              const centroidMarker = L.marker([centroid.lat, centroid.lng], {
                icon: L.divIcon({
                  className: 'custom-marker-icon',
                  html: `
                    <div style="
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
                      <i class="${iconClass}"></i>
                    </div>
                  `,
                  iconSize: [28, 28],
                  popupAnchor: [0, -14],
                  domainColor: domainColor
                }),
                zIndexOffset: 1000,
                domainName: domain_name,
                layerName: layerName,
                neighbourhoodName: neighbourhoodName
              });
              
              centroidMarker.featureGeometry = feature.geometry;
              centroidMarker.featureColor = domainColor;
              centroidMarker.geometryLayer = null;
              
              centroidMarker.on('click', function(e) {
                const markerId = L.stamp(this);
                
                if (this.geometryLayer && mapInstanceRef.current.hasLayer(this.geometryLayer)) {
                  mapInstanceRef.current.removeLayer(this.geometryLayer);
                  this.geometryLayer = null;
                  displayedGeometriesRef.current.delete(markerId);
                  
                  // Update tooltip to show "view geometry"
                  this.setTooltipContent(`
                    <div style="font-family: Inter, sans-serif;">
                      <h4 style="margin: 0 0 8px 0; color: #1a202c; font-size: 14px;">
                        ${feature_name || 'Unnamed Feature'}
                      </h4>
                      <p style="margin: 0; color: #64748b; font-size: 12px;">
                        <strong>Layer:</strong> ${layerName}<br>
                        <strong>Domain:</strong> ${domain_name}<br>
                        <strong>Type:</strong> ${feature.geometry.type}
                        ${neighbourhoodName ? `<br><strong>Neighbourhood:</strong> ${neighbourhoodName}` : ''}
                        <br><em style="color: #0891b2; font-size: 11px;">Click marker to view geometry</em>
                      </p>
                    </div>
                  `);
                } else {
                  this.geometryLayer = L.geoJSON(this.featureGeometry, {
                    style: {
                      color: this.featureColor,
                      weight: 3,
                      opacity: 0.9,
                      fillColor: this.featureColor,
                      fillOpacity: 0.3
                    }
                  }).addTo(mapInstanceRef.current);
              
                  this.geometryLayer.bringToFront();
                  
                  if (tileLayerRef.current) {
                    tileLayerRef.current.bringToBack();
                  }
                  
                  displayedGeometriesRef.current.set(markerId, {
                    layer: this.geometryLayer,
                    marker: this,
                    layerName: layerName
                  });
                  
                  // Update tooltip to show "hide geometry"
                  this.setTooltipContent(`
                    <div style="font-family: Inter, sans-serif;">
                      <h4 style="margin: 0 0 8px 0; color: #1a202c; font-size: 14px;">
                        ${feature_name || 'Unnamed Feature'}
                      </h4>
                      <p style="margin: 0; color: #64748b; font-size: 12px;">
                        <strong>Layer:</strong> ${layerName}<br>
                        <strong>Domain:</strong> ${domain_name}<br>
                        <strong>Type:</strong> ${feature.geometry.type}
                        ${neighbourhoodName ? `<br><strong>Neighbourhood:</strong> ${neighbourhoodName}` : ''}
                        <br><em style="color: #0891b2; font-size: 11px;">Click marker to hide geometry</em>
                      </p>
                    </div>
                  `);
                }
              });
              
              centroidMarker.on('mouseover', function(e) {
                // Close ALL tooltips on the map
                mapInstanceRef.current.eachLayer((mapLayer) => {
                  if (mapLayer.getTooltip && mapLayer.getTooltip() && mapLayer.isTooltipOpen()) {
                    mapLayer.closeTooltip();
                  }
                  if (mapLayer.getAllChildMarkers) {
                    mapLayer.getAllChildMarkers().forEach((m) => {
                      if (m.getTooltip && m.getTooltip() && m.isTooltipOpen()) {
                        m.closeTooltip();
                      }
                    });
                  }
                });
              });
              
              centroidMarker.bindTooltip(`
                <div style="font-family: Inter, sans-serif;">
                  <h4 style="margin: 0 0 8px 0; color: #1a202c; font-size: 14px;">
                    ${feature_name || 'Unnamed Feature'}
                  </h4>
                  <p style="margin: 0; color: #64748b; font-size: 12px;">
                    <strong>Layer:</strong> ${layerName}<br>
                    <strong>Domain:</strong> ${domain_name}<br>
                    <strong>Type:</strong> ${feature.geometry.type}
                    ${neighbourhoodName ? `<br><strong>Neighbourhood:</strong> ${neighbourhoodName}` : ''}
                    <br><em style="color: #0891b2; font-size: 11px;">Click marker to view geometry</em>
                  </p>
                </div>
              `, {
                permanent: false,
                direction: 'top',
                offset: [0, -20],
                opacity: 0.95,
                className: 'feature-marker-tooltip'
              });
              
              markersToAdd.push(centroidMarker);
            } catch (error) {
              console.warn(`Error adding centroid for feature in layer ${layerName}:`, error);
            }
          }
        } catch (error) {
          console.warn(`Error processing feature in layer ${layerName}:`, error);
        }
      }
      
      // Add markers in chunks with delays to keep UI responsive
      for (let i = 0; i < markersToAdd.length; i += CHUNK_SIZE) {
        const chunk = markersToAdd.slice(i, i + CHUNK_SIZE);
        
        // Add chunk to cluster
        chunk.forEach(marker => {
          globalClusterGroup.addLayer(marker);
        });
        
        // Update counts
        addedCount += chunk.length;
        setFeatureCount(prev => prev + chunk.length);
        
        // Yield to browser for rendering between chunks
        if (i + CHUNK_SIZE < markersToAdd.length) {
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
      
      if (addedCount > 0) {
        globalClusterGroup.refreshClusters();
      }
      
      markLayerAsLoaded(layerName);
      
    } catch (error) {
      console.error(`Error loading layer ${layerName}:`, error);
    }
  }, [selectedCity, loadCityFeatures, domainColors, availableLayers, markLayerAsLoaded, showNeighbourhoods]);

  const removeLayerIncremental = useCallback((layerName) => {
    const globalClusterGroup = clusterGroupsRef.current['__global__'];
    
    if (!globalClusterGroup) return;
    
    const layers = globalClusterGroup.getLayers();
    let removedCount = 0;
    
    layers.forEach(layer => {
      if (layer.options?.layerName === layerName) {
        // Also remove any displayed geometry for this marker
        const markerId = L.stamp(layer);
        const geomInfo = displayedGeometriesRef.current.get(markerId);
        if (geomInfo && geomInfo.layer && mapInstanceRef.current.hasLayer(geomInfo.layer)) {
          mapInstanceRef.current.removeLayer(geomInfo.layer);
          displayedGeometriesRef.current.delete(markerId);
        }
        
        globalClusterGroup.removeLayer(layer);
        removedCount++;
      }
    });
    
    if (removedCount > 0) {
      globalClusterGroup.refreshClusters();
      setFeatureCount(prev => Math.max(0, prev - removedCount));
      
      // Update ref only
      const newSet = new Set(loadedLayersRef.current);
      newSet.delete(layerName);
      loadedLayersRef.current = newSet;
    }
  }, []);

  // Load all active layers when city is selected
  useEffect(() => {
    if (!selectedCity || !mapInstanceRef.current) return;
    
    // Clear previous layers
    loadedLayersRef.current = new Set();
    previousActiveLayersRef.current = new Set();
    
    if (activeLayerNames.length > 0) {
      setIsLoadingData(true);
      
      previousActiveLayersRef.current = new Set(activeLayerNames);
      
      const timeoutId = setTimeout(async () => {
        try {
          // Stagger the layer loading to prevent overwhelming the browser
          const loadPromises = activeLayerNames.map((layerName, index) => {
            return new Promise(resolve => {
              setTimeout(async () => {
                await loadLayerIncremental(layerName);
                resolve();
              }, index * 50); // 50ms delay between starting each layer
            });
          });
          
          await Promise.all(loadPromises);
        } finally {
          setIsLoadingData(false);
        }
      }, 100);
      
      return () => {
        clearTimeout(timeoutId);
        setIsLoadingData(false);
      };
    } else {
      previousActiveLayersRef.current = new Set();
    }
  }, [selectedCity, activeLayerNames, loadLayerIncremental]);

  // Monitor layer changes and load/remove incrementally
  useEffect(() => {
    if (!selectedCity || !mapInstanceRef.current) return;
    
    const currentActive = new Set(activeLayerNames);
    const previousActive = previousActiveLayersRef.current;
    
    const addedLayers = [...currentActive].filter(layer => !previousActive.has(layer));
    const removedLayers = [...previousActive].filter(layer => !currentActive.has(layer));
    
    // Remove layers that were turned off
    removedLayers.forEach(layerName => {
      removeLayerIncremental(layerName);
    });
    
    // Load layers that were turned on in parallel
    if (addedLayers.length > 0) {
      setIsLoadingData(true);
      
      const timeoutId = setTimeout(async () => {
        try {
          // Load all added layers in parallel
          await Promise.all(
            addedLayers.map(layerName => loadLayerIncremental(layerName))
          );
        } finally {
          setIsLoadingData(false);
        }
      }, 100);
      
      return () => {
        clearTimeout(timeoutId);
        setIsLoadingData(false);
      };
    }
    
    previousActiveLayersRef.current = currentActive;
    
  }, [activeLayerNames, selectedCity, loadLayerIncremental, removeLayerIncremental]);

  // Update map when city is selected
  useEffect(() => {
    if (!mapInstanceRef.current) return;
  
    if (!selectedCity) {
      clearAllLayers();
      loadedLayersRef.current = new Set();
      previousActiveLayersRef.current = new Set();
      
      // Clear the global cluster group completely
      if (clusterGroupsRef.current['__global__']) {
        const globalCluster = clusterGroupsRef.current['__global__'];
        globalCluster.clearLayers();
        if (mapInstanceRef.current.hasLayer(globalCluster)) {
          mapInstanceRef.current.removeLayer(globalCluster);
        }
        clusterGroupsRef.current['__global__'] = null;
      }
      
      // Explicitly clear boundary when no city selected
      if (boundaryLayerRef.current) {
        if (mapInstanceRef.current.hasLayer(boundaryLayerRef.current)) {
          mapInstanceRef.current.removeLayer(boundaryLayerRef.current);
        }
        boundaryLayerRef.current = null;
      }

      if (neighbourhoodLayersRef.current) {
        neighbourhoodLayersRef.current.eachLayer((layer) => {
          if (mapInstanceRef.current.hasLayer(layer)) {
            mapInstanceRef.current.removeLayer(layer);
          }
        });
        neighbourhoodLayersRef.current = null;
      }
      
      mapInstanceRef.current.setView([20, 0], 2);
      
      const mapContainer = mapInstanceRef.current.getContainer();
      delete mapContainer.dataset.cityLat;
      delete mapContainer.dataset.cityLng;
      
      setTimeout(() => {
        displayCityMarkers();
      }, 100);
      
      return;
    }
  
    try {
      // This ensures old boundary is cleared before adding new one
      if (boundaryLayerRef.current) {
        if (mapInstanceRef.current.hasLayer(boundaryLayerRef.current)) {
          mapInstanceRef.current.removeLayer(boundaryLayerRef.current);
        }
        boundaryLayerRef.current = null;
      }
      
      // Clear existing cluster group when switching cities
      if (clusterGroupsRef.current['__global__']) {
        const globalCluster = clusterGroupsRef.current['__global__'];
        globalCluster.clearLayers();
        if (mapInstanceRef.current.hasLayer(globalCluster)) {
          mapInstanceRef.current.removeLayer(globalCluster);
        }
        clusterGroupsRef.current['__global__'] = null;
      }
      
      // Clear loaded layers tracking
      loadedLayersRef.current = new Set();
      setFeatureCount(0);
  
      // Store city coordinates in map container for recenter button
      const mapContainer = mapInstanceRef.current.getContainer();
      if (selectedCity.latitude && selectedCity.longitude) {
        mapContainer.dataset.cityLat = selectedCity.latitude;
        mapContainer.dataset.cityLng = selectedCity.longitude;
      }
  
      // Always parse and create fresh boundary layer
      if (selectedCity.boundary) {
        
        // Parse boundary - this creates a fresh object every time
        const boundary = JSON.parse(selectedCity.boundary);
  
        // Create completely new boundary layer
        const boundaryLayer = L.geoJSON(boundary, {
          style: {
            color: '#0891b2',
            weight: 3,
            opacity: 0.8,
            fillOpacity: 0.1
          }
        });
  
        // Add to map
        boundaryLayer.addTo(mapInstanceRef.current);
        boundaryLayerRef.current = boundaryLayer;
  
        // Fit map to boundary
        const bounds = boundaryLayer.getBounds();
        if (bounds.isValid()) {
          mapInstanceRef.current.fitBounds(bounds, { padding: [50, 50] });
        } else {
          console.warn('MapViewer: Invalid bounds for boundary');
        }
      } else if (selectedCity.latitude && selectedCity.longitude) {
        mapInstanceRef.current.setView([selectedCity.latitude, selectedCity.longitude], 12);
      }
    } catch (error) {
      console.error('MapViewer: Error updating map for selected city:', error);
      if (selectedCity.latitude && selectedCity.longitude) {
        mapInstanceRef.current.setView([selectedCity.latitude, selectedCity.longitude], 12);
      }
    }
  }, [selectedCity, boundaryHash, clearAllLayers, displayCityMarkers]);

  // Cleanup effect when selectedCity changes to null
  useEffect(() => {
    if (!selectedCity && abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      
      // Immediately clear loading state
      setIsLoadingData(false);
      isLoadingRef.current = false;
    }
  }, [selectedCity]);

  const showEnableLayersMessage = () => {
    if (!selectedCity) {
      alert(`${cities.length} total cities. Click on a city marker to explore.`);
    } else {
      alert('Enable layers in the sidebar to view features on the map.');
    }
  };
  
  return (
    <div className="map-viewer">
      <div ref={mapRef} className="map-container" />
      
      {isLoadingData && (
        <div className="map-loading-overlay">
          <div className="loading-spinner">
            <i className="fas fa-spinner fa-spin"></i>
            <span>Loading map...</span>
            <div style={{ fontSize: '12px', marginTop: '8px', color: '#64748b' }}>
              {loadedLayersRef.current.size} / {activeLayerNames.length} layers complete
            </div>
          </div>
        </div>
      )}
      
      <div 
        className="map-feature-count" 
        onClick={showEnableLayersMessage}
        style={{ cursor: 'pointer' }}
      >
        {!selectedCity ? (
          <>
            <i className="fas fa-city"></i>
            <span>{cities.length.toLocaleString()} total {cities.length === 1 ? 'city' : 'cities'}</span>
          </>
        ) : (
          <>
            <i className="fas fa-map-marker-alt"></i>
            <span>{featureCount.toLocaleString()} features loaded</span>
          </>
        )}
      </div>
    </div>
  );
};

export default MapViewer;
import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import 'leaflet.markercluster';
import '../styles/MapViewer.css';

// Fix for default markers
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

const MapViewer = ({
  selectedCity,
  activeLayers = {},
  domainColors = {},
  loadCityFeatures,
  availableLayers = {},
  mapView = 'street'
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

  // Initialize map - ONLY ONCE
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    console.log('MapViewer: Initializing map');
    
    const map = L.map(mapRef.current, {
      zoomControl: true,
      minZoom: 2,
      maxZoom: 18
    }).setView([43.4643, -80.5204], 12);

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
          // Always try boundary first
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
          
          // Fallback: try to get city info from the map container's data
          const mapContainer = map.getContainer();
          const cityLat = parseFloat(mapContainer.dataset.cityLat);
          const cityLng = parseFloat(mapContainer.dataset.cityLng);
          
          if (!isNaN(cityLat) && !isNaN(cityLng)) {
            map.setView([cityLat, cityLng], 12);
          }
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
      console.log('MapViewer: Cleaning up map');
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
      console.log('MapViewer: Cannot change map view - map not initialized', {
        hasMap: !!mapInstanceRef.current,
        hasTileLayer: !!tileLayerRef.current
      });
      return;
    }

    console.log('MapViewer: Changing map view to:', mapView);

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

    console.log('MapViewer: New tile layer added, waiting to re-add overlays...');

    // Re-add all overlays after a short delay
    setTimeout(() => {
      console.log('MapViewer: Re-adding overlays');
      
      // Re-add cluster groups
      Object.entries(clusterGroupsRef.current).forEach(([layerName, clusterGroup]) => {
        if (clusterGroup) {
          const markerCount = clusterGroup.getLayers().length;
          console.log(`MapViewer: Re-adding cluster group for ${layerName} with ${markerCount} markers`);
          
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
        console.log('MapViewer: Re-adding boundary layer');
        if (mapInstanceRef.current.hasLayer(boundaryLayerRef.current)) {
          mapInstanceRef.current.removeLayer(boundaryLayerRef.current);
        }
        boundaryLayerRef.current.addTo(mapInstanceRef.current);
        boundaryLayerRef.current.bringToFront();
      }

      // Re-add non-point layer
      if (nonPointLayerRef.current) {
        console.log('MapViewer: Re-adding non-point layer');
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
      
      console.log('MapViewer: Overlays re-added successfully');
    }, 200);
  }, [mapView]);

  // Clear all markers and layers
  const clearAllLayers = useCallback(() => {
    if (!mapInstanceRef.current) return;

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

    setFeatureCount(0);
  }, []);

  // Update map when city is selected
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    clearAllLayers();

    if (!selectedCity) {
      // Clear stored city data when no city selected
      const mapContainer = mapInstanceRef.current.getContainer();
      delete mapContainer.dataset.cityLat;
      delete mapContainer.dataset.cityLng;
      return;
    }

    try {
      console.log('MapViewer: Updating map for city:', selectedCity.name);

      // Store city coordinates in map container for recenter button
      const mapContainer = mapInstanceRef.current.getContainer();
      if (selectedCity.latitude && selectedCity.longitude) {
        mapContainer.dataset.cityLat = selectedCity.latitude;
        mapContainer.dataset.cityLng = selectedCity.longitude;
      }

      if (selectedCity.boundary) {
        const boundary = JSON.parse(selectedCity.boundary);

        const boundaryLayer = L.geoJSON(boundary, {
          style: {
            color: '#0891b2',
            weight: 3,
            opacity: 0.8,
            fillOpacity: 0.1
          }
        });

        boundaryLayer.addTo(mapInstanceRef.current);
        boundaryLayerRef.current = boundaryLayer;

        const bounds = boundaryLayer.getBounds();
        if (bounds.isValid()) {
          mapInstanceRef.current.fitBounds(bounds, { padding: [50, 50] });
        }
      } else if (selectedCity.latitude && selectedCity.longitude) {
        mapInstanceRef.current.setView([selectedCity.latitude, selectedCity.longitude], 12);
      }
    } catch (error) {
      console.error('Error updating map for selected city:', error);
      if (selectedCity.latitude && selectedCity.longitude) {
        mapInstanceRef.current.setView([selectedCity.latitude, selectedCity.longitude], 12);
      }
    }
  }, [selectedCity, clearAllLayers]);

  // Load and display features
  const loadAndDisplayFeatures = useCallback(async () => {
    if (!selectedCity || !mapInstanceRef.current || !loadCityFeatures) {
      console.log('MapViewer: Skipping feature load due to missing dependencies', {
        selectedCity: !!selectedCity,
        mapInstance: !!mapInstanceRef.current,
        loadCityFeatures: !!loadCityFeatures
      });
      return;
    }

    const safeActiveLayers = activeLayers || {};
    const activeLayerNames = Object.keys(safeActiveLayers).filter(layer => safeActiveLayers[layer]);
    
    console.log('MapViewer: Loading features for layers:', activeLayerNames);

    if (activeLayerNames.length === 0) {
      Object.entries(clusterGroupsRef.current).forEach(([layerName, clusterGroup]) => {
        if (clusterGroup && mapInstanceRef.current.hasLayer(clusterGroup)) {
          mapInstanceRef.current.removeLayer(clusterGroup);
        }
      });
      clusterGroupsRef.current = {};

      if (nonPointLayerRef.current && mapInstanceRef.current.hasLayer(nonPointLayerRef.current)) {
        mapInstanceRef.current.removeLayer(nonPointLayerRef.current);
        nonPointLayerRef.current = null;
      }

      setFeatureCount(0);
      return;
    }

    try {
      setIsLoadingData(true);

      console.log('MapViewer: Calling loadCityFeatures with active layers:', activeLayerNames);
      const features = await loadCityFeatures(selectedCity.name, safeActiveLayers);
      console.log('MapViewer: Loaded features:', features.length);

      // Clear existing cluster groups and non-point layers
      Object.entries(clusterGroupsRef.current).forEach(([layerName, clusterGroup]) => {
        if (clusterGroup && mapInstanceRef.current.hasLayer(clusterGroup)) {
          mapInstanceRef.current.removeLayer(clusterGroup);
        }
      });
      clusterGroupsRef.current = {};

      if (nonPointLayerRef.current && mapInstanceRef.current.hasLayer(nonPointLayerRef.current)) {
        mapInstanceRef.current.removeLayer(nonPointLayerRef.current);
        nonPointLayerRef.current = null;
      }

      // Group features by layer and domain
      const groupedFeatures = {};
      features.forEach(feature => {
        const layerName = feature.properties.layer_name;
        const domainName = feature.properties.domain_name;
        if (!groupedFeatures[layerName]) {
          groupedFeatures[layerName] = [];
        }
        groupedFeatures[layerName].push({
          ...feature,
          domainName
        });
      });

      console.log('MapViewer: Grouped features by layer:', Object.keys(groupedFeatures));

      let totalFeatures = 0;
      const safeAvailableLayers = availableLayers || {};

      // Create clustered markers for each active layer
      Object.entries(groupedFeatures).forEach(([layerName, layerFeatures]) => {
        if (!safeActiveLayers[layerName]) return;

        const clusterGroup = L.markerClusterGroup({
          maxClusterRadius: 80,
          spiderfyOnMaxZoom: true,
          showCoverageOnHover: false,
          zoomToBoundsOnClick: true,
          spiderfyDistanceMultiplier: 1.5,
          iconCreateFunction: function(cluster) {
            const count = cluster.getChildCount();
            const firstMarker = cluster.getAllChildMarkers()[0];
            const domainColor = firstMarker?.options?.icon?.options?.domainColor || '#666666';
            
            return L.divIcon({
              html: `<div style="background-color: ${domainColor}; width: 40px; height: 40px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 14px; box-sizing: border-box;">${count}</div>`,
              className: 'custom-cluster-icon',
              iconSize: L.point(40, 40),
              iconAnchor: L.point(20, 20)
            });
          },
          chunkedLoading: true,
          chunkInterval: 200,
          chunkDelay: 50
        });

        // Event handler to ensure spiderfied markers are on top
        clusterGroup.on('spiderfied', function(e) {
          const cluster = e.cluster;
          const markers = e.markers;
          
          // Set high z-index for all spiderfied markers
          markers.forEach((marker, index) => {
            if (marker._icon) {
              marker._icon.style.zIndex = 10000 + index;
            }
          });
          
          // Fade out the cluster icon when spiderfied
          if (cluster._icon) {
            cluster._icon.style.opacity = '0.3';
            cluster._icon.style.transition = 'opacity 0.3s';
          }
        });

        // Reset cluster opacity when unspiderfied
        clusterGroup.on('unspiderfied', function(e) {
          const cluster = e.cluster;
          if (cluster._icon) {
            cluster._icon.style.opacity = '1';
          }
        });

        let markerCount = 0;

        layerFeatures.forEach((feature) => {
          try {
            if (!feature.geometry || !feature.geometry.type || !feature.geometry.coordinates) {
              console.warn(`MapViewer: Invalid geometry for feature in layer ${layerName}`, feature);
              return;
            }

            const { feature_name, domain_name } = feature.properties;
            const domainColor = domainColors[domain_name] || '#666666';
            const iconClass = safeAvailableLayers[layerName]?.icon || layerIcons[layerName] || 'fas fa-map-marker-alt';

            if (feature.geometry.type === 'Point') {
              const { coordinates } = feature.geometry;
              if (!Array.isArray(coordinates) || coordinates.length < 2) {
                console.warn(`MapViewer: Invalid point coordinates in layer ${layerName}`, coordinates);
                return;
              }

              const [lon, lat] = coordinates;

              if (isNaN(lon) || isNaN(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) {
                console.warn(`MapViewer: Invalid coordinates in layer ${layerName}`, { lon, lat });
                return;
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

              const marker = L.marker([lat, lon], {
                icon: customIcon,
                zIndexOffset: 1000
              });

              marker.bindPopup(`
                <div style="font-family: Inter, sans-serif;">
                  <h4 style="margin: 0 0 8px 0; color: #1a202c; font-size: 14px;">
                    ${feature_name || 'Unnamed Feature'}
                  </h4>
                  <p style="margin: 0; color: #64748b; font-size: 12px;">
                    <strong>Layer:</strong> ${layerName}<br>
                    <strong>Domain:</strong> ${domain_name}
                  </p>
                </div>
              `);

              clusterGroup.addLayer(marker);
              markerCount++;
            } else {
              // Handle non-point geometries (Polygon, LineString, etc.)
              try {
                // Calculate the true centroid
                const centroid = calculateCentroid(feature.geometry);

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
                  zIndexOffset: 1000
                });

                // Store the geometry data with the marker
                centroidMarker.featureGeometry = feature.geometry;
                centroidMarker.featureColor = domainColor;
                centroidMarker.geometryLayer = null;

                // Handle click to show/hide geometry
                centroidMarker.on('click', function(e) {
                  // Remove existing geometry layer if it exists
                  if (this.geometryLayer && mapInstanceRef.current.hasLayer(this.geometryLayer)) {
                    mapInstanceRef.current.removeLayer(this.geometryLayer);
                    this.geometryLayer = null;
                  }

                  // Create and add new geometry layer
                  this.geometryLayer = L.geoJSON(this.featureGeometry, {
                    style: {
                      color: this.featureColor,
                      weight: 3,
                      opacity: 0.9,
                      fillColor: this.featureColor,
                      fillOpacity: 0.3
                    }
                  }).addTo(mapInstanceRef.current);

                  // Bring geometry layer to front but below popups
                  this.geometryLayer.bringToFront();
                  
                  // Ensure tile layer stays at back
                  if (tileLayerRef.current) {
                    tileLayerRef.current.bringToBack();
                  }
                });

                // Remove geometry when popup closes
                centroidMarker.on('popupclose', function() {
                  if (this.geometryLayer && mapInstanceRef.current.hasLayer(this.geometryLayer)) {
                    mapInstanceRef.current.removeLayer(this.geometryLayer);
                    this.geometryLayer = null;
                  }
                });

                centroidMarker.bindPopup(`
                  <div style="font-family: Inter, sans-serif;">
                    <h4 style="margin: 0 0 8px 0; color: #1a202c; font-size: 14px;">
                      ${feature_name || 'Unnamed Feature'}
                    </h4>
                    <p style="margin: 0; color: #64748b; font-size: 12px;">
                      <strong>Layer:</strong> ${layerName}<br>
                      <strong>Domain:</strong> ${domain_name}<br>
                      <strong>Type:</strong> ${feature.geometry.type}<br>
                      <em style="color: #0891b2; font-size: 11px;">Click marker to view geometry</em>
                    </p>
                  </div>
                `);

                clusterGroup.addLayer(centroidMarker);
                markerCount++;
              } catch (error) {
                console.warn(`MapViewer: Error adding centroid for feature in layer ${layerName}:`, error);
              }
            }
          } catch (error) {
            console.warn(`MapViewer: Error processing feature in layer ${layerName}:`, error);
          }
        });

        console.log(`MapViewer: Processed ${markerCount} features for layer ${layerName}`);
        totalFeatures += markerCount;

        if (clusterGroup.getLayers().length > 0) {
          clusterGroup.addTo(mapInstanceRef.current);
          clusterGroupsRef.current[layerName] = clusterGroup;
          console.log(`MapViewer: Added cluster group for ${layerName} with ${clusterGroup.getLayers().length} markers`);
        }
      });

      setFeatureCount(totalFeatures);
      console.log(`MapViewer: Total features displayed: ${totalFeatures}`);

      setTimeout(() => {
        mapInstanceRef.current.invalidateSize();
        Object.values(clusterGroupsRef.current).forEach(group => {
          if (group && typeof group.refreshClusters === 'function') {
            group.refreshClusters();
          }
        });
      }, 100);
    } catch (error) {
      console.error('MapViewer: Error loading and displaying features:', error);
    } finally {
      setIsLoadingData(false);
    }
  }, [selectedCity, activeLayers, domainColors, loadCityFeatures, availableLayers]);

  // Effect to load features when activeLayers change
  useEffect(() => {
    if (loadFeaturesTimeoutRef.current) {
      clearTimeout(loadFeaturesTimeoutRef.current);
    }

    loadFeaturesTimeoutRef.current = setTimeout(() => {
      loadAndDisplayFeatures();
    }, 100);

    return () => {
      if (loadFeaturesTimeoutRef.current) {
        clearTimeout(loadFeaturesTimeoutRef.current);
      }
    };
  }, [loadAndDisplayFeatures]);

  const showEnableLayersMessage = () => {
    alert('Enable layers in the sidebar to view features on the map.');
  };

  const safeActiveLayers = activeLayers || {};
  const hasActiveLayers = Object.values(safeActiveLayers).some(isActive => isActive);

  return (
    <div className="map-viewer">
      <div ref={mapRef} className="map-container" />
      
      {isLoadingData && (
        <div className="map-loading-overlay">
          <div className="loading-spinner">
            <i className="fas fa-spinner fa-spin"></i>
            <span>Loading map data...</span>
          </div>
        </div>
      )}
      
      <div 
        className="map-feature-count" 
        onClick={showEnableLayersMessage}
        style={{ cursor: 'pointer' }}
      >
        <i className="fas fa-map-marker-alt"></i>
        <span>{featureCount.toLocaleString()} features loaded</span>
      </div>
      
      {!selectedCity && (
        <div className="map-placeholder">
          <div className="placeholder-content">
            <i className="fas fa-map-marker-alt"></i>
            <h3>Select a City</h3>
            <p>Choose a city from the dropdown above to view its data layers on the map.</p>
          </div>
        </div>
      )}
      
      {selectedCity && !hasActiveLayers && (
        <div className="map-overlay">
          <div className="overlay-content">
            <i className="fas fa-layers"></i>
            <h4>No Layers Active</h4>
            <p>Enable some layers in the sidebar to view data on the map.</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default MapViewer;
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

const MapViewer = ({ 
  selectedCity, 
  activeLayers, 
  domainColors, 
  loadCityFeatures,
  availableLayers
}) => {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const clusterGroupsRef = useRef({});
  const boundaryLayerRef = useRef(null);
  const nonPointLayerRef = useRef(null);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [featureCount, setFeatureCount] = useState(0);
  const loadFeaturesTimeoutRef = useRef(null);

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current, {
      zoomControl: true,
      minZoom: 2,
      maxZoom: 18
    }).setView([43.4643, -80.5204], 12);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    mapInstanceRef.current = map;

    return () => {
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

  // Clear all markers and layers
  const clearAllLayers = useCallback(() => {
    if (!mapInstanceRef.current) return;

    // Clear cluster groups
    Object.entries(clusterGroupsRef.current).forEach(([layerName, clusterGroup]) => {
      if (clusterGroup && mapInstanceRef.current.hasLayer(clusterGroup)) {
        mapInstanceRef.current.removeLayer(clusterGroup);
      }
    });
    clusterGroupsRef.current = {};
    
    // Clear boundary layer
    if (boundaryLayerRef.current && mapInstanceRef.current.hasLayer(boundaryLayerRef.current)) {
      mapInstanceRef.current.removeLayer(boundaryLayerRef.current);
      boundaryLayerRef.current = null;
    }
    
    // Clear non-point layer
    if (nonPointLayerRef.current && mapInstanceRef.current.hasLayer(nonPointLayerRef.current)) {
      mapInstanceRef.current.removeLayer(nonPointLayerRef.current);
      nonPointLayerRef.current = null;
    }
    
    setFeatureCount(0);
  }, []);

  // Update map when city is selected
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    // Clear existing layers when city changes
    clearAllLayers();

    if (!selectedCity) return;

    try {
      console.log('MapViewer: Updating map for city:', selectedCity.name);
      
      // Parse and display city boundary
      if (selectedCity.boundary) {
        const boundary = JSON.parse(selectedCity.boundary);
        
        // Create boundary layer
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
        
        // Fit map to boundary with padding
        const bounds = boundaryLayer.getBounds();
        if (bounds.isValid()) {
          mapInstanceRef.current.fitBounds(bounds, { padding: [50, 50] });
        }
      } else if (selectedCity.latitude && selectedCity.longitude) {
        // Fallback to city coordinates
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

    const activeLayerNames = Object.keys(activeLayers).filter(layer => activeLayers[layer]);
    
    console.log('MapViewer: Loading features for layers:', activeLayerNames);
    
    if (activeLayerNames.length === 0) {
      // Clear only existing feature layers (cluster groups and non-point layers), preserve boundary
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
      
      // Load features using the passed function
      console.log('MapViewer: Calling loadCityFeatures with active layers:', activeLayerNames);
      const features = await loadCityFeatures(selectedCity.name, activeLayers);
      console.log('MapViewer: Loaded features:', features.length, features);
      console.log('MapViewer: Active layers:', activeLayers);
      console.log('MapViewer: Available layers:', availableLayers);
      
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
      
      console.log('MapViewer: Grouped features by layer:', Object.keys(groupedFeatures), groupedFeatures);

      let totalFeatures = 0;
      
      // Create clustered markers for each active layer (all geometry types)
      Object.entries(groupedFeatures).forEach(([layerName, layerFeatures]) => {
        if (!activeLayers[layerName]) return; // Skip inactive layers
        
        // Create marker cluster group for all features
        const clusterGroup = L.markerClusterGroup({
          maxClusterRadius: 80,
          spiderfyOnMaxZoom: true,
          showCoverageOnHover: false,
          zoomToBoundsOnClick: true,
          iconCreateFunction: function(cluster) {
            const count = cluster.getChildCount();
            const firstMarker = cluster.getAllChildMarkers()[0];
            const domainColor = firstMarker?.options?.icon?.options?.domainColor || '#666666';
            
            return L.divIcon({
              html: `<div style="background-color: ${domainColor}; width: 40px; height: 40px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 14px;">${count}</div>`,
              className: 'custom-cluster-icon',
              iconSize: L.point(40, 40)
            });
          },
          chunkedLoading: true,
          chunkInterval: 200,
          chunkDelay: 50
        });
        
        let markerCount = 0;
        
        // Process features
        layerFeatures.forEach((feature) => {
          try {
            if (!feature.geometry || !feature.geometry.type || !feature.geometry.coordinates) {
              console.warn(`MapViewer: Invalid geometry for feature in layer ${layerName}`, feature);
              return;
            }
            
            const { feature_name, domain_name } = feature.properties;
            const domainColor = domainColors[domain_name] || '#666666';
            // Use icon from availableLayers for custom layers, fallback to layerIcons or default
            const iconClass = availableLayers[layerName]?.icon || layerIcons[layerName] || 'fas fa-map-marker-alt';
            
            if (feature.geometry.type === 'Point') {
              const { coordinates } = feature.geometry;
              
              if (!Array.isArray(coordinates) || coordinates.length < 2) {
                console.warn(`MapViewer: Invalid point coordinates in layer ${layerName}`, coordinates);
                return;
              }
              
              const [lon, lat] = coordinates;
              
              // Debug logging
              if (markerCount < 5) {
                console.log(`MapViewer: Creating marker ${markerCount} for layer ${layerName}:`, {
                  original: coordinates,
                  lon,
                  lat,
                  leafletOrder: [lat, lon],
                  featureName: feature_name
                });
              }
              
              if (isNaN(lon) || isNaN(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) {
                console.warn(`MapViewer: Invalid coordinates in layer ${layerName}`, {
                  lon,
                  lat,
                  original: coordinates,
                  feature: feature_name
                });
                return;
              }
              
              // Create custom icon with FontAwesome icon, matching LayerModal styling
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
                iconAnchor: [14, 14],
                popupAnchor: [0, -14],
                domainColor: domainColor
              });
              
              const marker = L.marker([lat, lon], {
                icon: customIcon
              });
              
              // Popup content matching LayerModal
              marker.bindPopup(`
                <div style="font-family: Inter, sans-serif;">
                  <h4 style="margin: 0 0 8px 0; color: #1a202c; font-size: 14px;">
                    ${feature_name || 'Unnamed Feature'}
                  </h4>
                  <p style="margin: 0; color: #64748b; font-size: 12px;">
                    <strong>Layer:</strong> ${layerName}<br>
                    <strong>Domain:</strong> ${domain_name}${feature.geometry.type !== 'Point' ? `<br><strong>Type:</strong> ${feature.geometry.type}` : ''}
                  </p>
                </div>
              `);
              
              clusterGroup.addLayer(marker);
              markerCount++;
            } else {
              // Handle non-point geometries (Polygon, LineString, etc.)
              // Create a marker at the centroid for clustering
              try {
                const tempLayer = L.geoJSON(feature.geometry);
                const bounds = tempLayer.getBounds();
                if (bounds.isValid()) {
                  const centroid = bounds.getCenter();
                  
                  // Create a marker that will be clustered
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
                      iconAnchor: [14, 14],
                      popupAnchor: [0, -14],
                      domainColor: domainColor
                    })
                  });
                  
                  // Store the geometry data for displaying on click
                  centroidMarker.featureGeometry = feature.geometry;
                  centroidMarker.featureColor = domainColor;
                  
                  // When marker is clicked, show the actual geometry
                  centroidMarker.on('click', function(e) {
                    // Remove any previously displayed geometry layer
                    if (this.geometryLayer && mapInstanceRef.current.hasLayer(this.geometryLayer)) {
                      mapInstanceRef.current.removeLayer(this.geometryLayer);
                    }
                    
                    // Display the actual geometry
                    this.geometryLayer = L.geoJSON(this.featureGeometry, {
                      style: {
                        color: this.featureColor,
                        weight: 3,
                        opacity: 0.9,
                        fillColor: this.featureColor,
                        fillOpacity: 0.3
                      }
                    }).addTo(mapInstanceRef.current);
                    
                    // Remove geometry when popup is closed
                    this.once('popupclose', function() {
                      if (this.geometryLayer && mapInstanceRef.current.hasLayer(this.geometryLayer)) {
                        mapInstanceRef.current.removeLayer(this.geometryLayer);
                      }
                    });
                  });
                  
                  centroidMarker.bindPopup(`
                    <div style="font-family: Inter, sans-serif;">
                      <h4 style="margin: 0 0 8px 0; color: #1a202c; font-size: 14px;">
                        ${feature_name || 'Unnamed Feature'}
                      </h4>
                      <p style="margin: 0; color: #64748b; font-size: 12px;">
                        <strong>Layer:</strong> ${layerName}<br>
                        <strong>Domain:</strong> ${domain_name}<br>
                        <strong>Type:</strong> ${feature.geometry.type}
                      </p>
                    </div>
                  `);
                  
                  clusterGroup.addLayer(centroidMarker);
                  markerCount++;
                }
              } catch (error) {
                console.warn(`MapViewer: Error adding centroid for feature in layer ${layerName}:`, error);
              }
            }
          } catch (error) {
            console.warn(`MapViewer: Error processing feature in layer ${layerName}:`, error, feature);
          }
        });
        
        console.log(`MapViewer: Processed ${markerCount} features for layer ${layerName}`);
        console.log(`MapViewer: Cluster group has ${clusterGroup.getLayers().length} markers`);
        totalFeatures += markerCount;
        
        // Add cluster group to map if there are features
        if (clusterGroup.getLayers().length > 0) {
          clusterGroup.addTo(mapInstanceRef.current);
          clusterGroupsRef.current[layerName] = clusterGroup;
          console.log(`MapViewer: Added cluster group for ${layerName} with ${clusterGroup.getLayers().length} markers`);
        }
      });
      
      setFeatureCount(totalFeatures);
      console.log(`MapViewer: Total features displayed: ${totalFeatures}`);
      
    } catch (error) {
      console.error('MapViewer: Error loading and displaying features:', error);
    } finally {
      setIsLoadingData(false);
    }
  }, [selectedCity, activeLayers, domainColors, loadCityFeatures, availableLayers]);
  
  // Effect to load features when activeLayers or availableLayers change
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
  }, [loadAndDisplayFeatures, activeLayers, availableLayers]);

  const hasActiveLayers = Object.values(activeLayers).some(isActive => isActive);

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
      
      {featureCount > 0 && (
        <div className="map-info">
          <div className="info-content">
            <i className="fas fa-map-marker-alt"></i>
            <span>{featureCount.toLocaleString()} features loaded</span>
          </div>
        </div>
      )}
      
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
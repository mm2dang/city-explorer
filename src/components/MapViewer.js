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

// Layer icon mapping
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
  loadCityFeatures 
}) => {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const clusterGroupsRef = useRef({});
  const boundaryLayerRef = useRef(null);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [featureCount, setFeatureCount] = useState(0);

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current).setView([43.4643, -80.5204], 12);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    mapInstanceRef.current = map;

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Clear all markers and layers
  const clearAllLayers = useCallback(() => {
    // Clear cluster groups
    Object.values(clusterGroupsRef.current).forEach(clusterGroup => {
      if (clusterGroup && mapInstanceRef.current) {
        mapInstanceRef.current.removeLayer(clusterGroup);
      }
    });
    clusterGroupsRef.current = {};
    
    // Clear boundary layer
    if (boundaryLayerRef.current && mapInstanceRef.current) {
      mapInstanceRef.current.removeLayer(boundaryLayerRef.current);
      boundaryLayerRef.current = null;
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
      mapInstanceRef.current.fitBounds(bounds, { padding: [50, 50] });
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

  // Load and display features when active layers change
  const loadAndDisplayFeatures = useCallback(async () => {
    if (!selectedCity || !mapInstanceRef.current || !loadCityFeatures) return;

    const activeLayerNames = Object.keys(activeLayers).filter(layer => activeLayers[layer]);
    
    console.log('MapViewer: Loading features for layers:', activeLayerNames);
    
    if (activeLayerNames.length === 0) {
      // Clear cluster groups but keep boundary
      Object.entries(clusterGroupsRef.current).forEach(([layerName, clusterGroup]) => {
        if (clusterGroup && mapInstanceRef.current) {
          mapInstanceRef.current.removeLayer(clusterGroup);
        }
      });
      clusterGroupsRef.current = {};
      setFeatureCount(0);
      return;
    }

    try {
      setIsLoadingData(true);
      
      // Load features using the passed function
      console.log('MapViewer: Calling loadCityFeatures...');
      const features = await loadCityFeatures(selectedCity.name, activeLayers);
      console.log('MapViewer: Loaded features:', features.length);
      
      // Clear existing cluster groups but keep boundary
      Object.entries(clusterGroupsRef.current).forEach(([layerName, clusterGroup]) => {
        if (clusterGroup && mapInstanceRef.current) {
          mapInstanceRef.current.removeLayer(clusterGroup);
        }
      });
      clusterGroupsRef.current = {};
      
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

      let totalMarkers = 0;

      // Create clustered markers for each active layer
      Object.entries(groupedFeatures).forEach(([layerName, layerFeatures]) => {
        if (!activeLayers[layerName]) return; // Skip inactive layers
        
        // Create marker cluster group with custom styling
        const clusterGroup = L.markerClusterGroup({
          maxClusterRadius: 80,
          spiderfyOnMaxZoom: true,
          showCoverageOnHover: false,
          zoomToBoundsOnClick: true,
          iconCreateFunction: function(cluster) {
            const count = cluster.getChildCount();
            // Use domain color from first marker in cluster
            const firstMarker = cluster.getAllChildMarkers()[0];
            const domainColor = firstMarker.options.icon.options.domainColor || '#666666';
            
            return L.divIcon({
              html: `<div style="background-color: ${domainColor}; width: 40px; height: 40px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 14px;">${count}</div>`,
              className: 'custom-cluster-icon',
              iconSize: L.point(40, 40)
            });
          },
          // Chunked loading for better performance
          chunkedLoading: true,
          chunkInterval: 200,
          chunkDelay: 50
        });
        
        let markerCount = 0;
        
        // Batch process markers in chunks to avoid blocking UI
        const BATCH_SIZE = 1000;
        
        const processBatch = (startIndex) => {
          const endIndex = Math.min(startIndex + BATCH_SIZE, layerFeatures.length);
          const batch = layerFeatures.slice(startIndex, endIndex);
          
          batch.forEach(feature => {
            try {
              if (!feature.geometry || !feature.geometry.coordinates) {
                return;
              }
              
              const { coordinates } = feature.geometry;
              
              if (!Array.isArray(coordinates) || coordinates.length !== 2) {
                return;
              }
              
              const [lon, lat] = coordinates;
              if (isNaN(lon) || isNaN(lat)) {
                return;
              }
              
              const { feature_name, domain_name } = feature.properties;
              const domainColor = domainColors[domain_name] || '#666666';
              const iconClass = layerIcons[layerName] || 'fas fa-map-marker-alt';
              
              // Create custom icon with FontAwesome icon
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
                  ">
                    <i class="${iconClass}"></i>
                  </div>
                `,
                iconSize: [28, 28],
                iconAnchor: [14, 14],
                popupAnchor: [0, -14],
                domainColor: domainColor // Store for cluster icon
              });
              
              const marker = L.marker([lat, lon], {
                icon: customIcon
              });
              
              // Add popup with feature information
              marker.bindPopup(`
                <div style="font-family: Inter, sans-serif;">
                  <h4 style="margin: 0 0 8px 0; color: #1a202c; font-size: 14px;">
                    ${feature_name || 'Unnamed Feature'}
                  </h4>
                  <p style="margin: 0; color: #64748b; font-size: 12px;">
                    <strong>Layer:</strong> ${layerName.replace(/_/g, ' ')}<br>
                    <strong>Domain:</strong> ${domain_name}
                  </p>
                </div>
              `);
              
              clusterGroup.addLayer(marker);
              markerCount++;
            } catch (error) {
              console.warn('MapViewer: Error creating marker:', error);
            }
          });
          
          // Process next batch if there are more features
          if (endIndex < layerFeatures.length) {
            setTimeout(() => processBatch(endIndex), 0);
          }
        };
        
        // Start processing batches
        processBatch(0);
        
        console.log(`MapViewer: Created ${markerCount} markers for layer ${layerName}`);
        totalMarkers += markerCount;
        
        // Add cluster group to map and store reference
        clusterGroup.addTo(mapInstanceRef.current);
        clusterGroupsRef.current[layerName] = clusterGroup;
      });
      
      setFeatureCount(totalMarkers);
      
    } catch (error) {
      console.error('Error loading and displaying features:', error);
    } finally {
      setIsLoadingData(false);
    }
  }, [selectedCity, activeLayers, domainColors, loadCityFeatures]);

  // Load features when active layers change
  useEffect(() => {
    loadAndDisplayFeatures();
  }, [loadAndDisplayFeatures]);

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
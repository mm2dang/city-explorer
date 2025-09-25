import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '../styles/MapViewer.css';

// Fix for default markers
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const MapViewer = ({ 
  selectedCity, 
  activeLayers, 
  domainColors, 
  loadCityFeatures 
}) => {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef({});
  const boundaryLayerRef = useRef(null);
  const [isLoadingData, setIsLoadingData] = useState(false);

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
    // Clear feature markers
    Object.values(markersRef.current).forEach(layerGroup => {
      if (layerGroup && mapInstanceRef.current) {
        mapInstanceRef.current.removeLayer(layerGroup);
      }
    });
    markersRef.current = {};
    
    // Clear boundary layer
    if (boundaryLayerRef.current && mapInstanceRef.current) {
      mapInstanceRef.current.removeLayer(boundaryLayerRef.current);
      boundaryLayerRef.current = null;
    }
  }, []);

  // Update map when city is selected
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    // Clear existing layers when city changes
    clearAllLayers();

    if (!selectedCity) return;

    try {
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
        
        // Fit map to boundary
        mapInstanceRef.current.fitBounds(boundaryLayer.getBounds());
      } else {
        // Fallback to city coordinates
        mapInstanceRef.current.setView([selectedCity.latitude, selectedCity.longitude], 12);
      }
    } catch (error) {
      console.error('Error updating map for selected city:', error);
      // Fallback to city coordinates
      if (selectedCity.latitude && selectedCity.longitude) {
        mapInstanceRef.current.setView([selectedCity.latitude, selectedCity.longitude], 12);
      }
    }
  }, [selectedCity, clearAllLayers]);

  // Load and display features when active layers change
  const loadAndDisplayFeatures = useCallback(async () => {
    if (!selectedCity || !mapInstanceRef.current || !loadCityFeatures) return;

    const activeLayerNames = Object.keys(activeLayers).filter(layer => activeLayers[layer]);
    
    if (activeLayerNames.length === 0) {
      // Clear feature markers but keep boundary
      Object.entries(markersRef.current).forEach(([layerName, layerGroup]) => {
        if (layerGroup && mapInstanceRef.current) {
          mapInstanceRef.current.removeLayer(layerGroup);
        }
      });
      markersRef.current = {};
      return;
    }

    try {
      setIsLoadingData(true);
      
      // Load features using the passed function
      const features = await loadCityFeatures(selectedCity.name, activeLayers);
      
      // Clear existing feature markers but keep boundary
      Object.entries(markersRef.current).forEach(([layerName, layerGroup]) => {
        if (layerGroup && mapInstanceRef.current) {
          mapInstanceRef.current.removeLayer(layerGroup);
        }
      });
      markersRef.current = {};
      
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

      // Create markers for each active layer
      Object.entries(groupedFeatures).forEach(([layerName, layerFeatures]) => {
        if (!activeLayers[layerName]) return; // Skip inactive layers
        
        const layerGroup = L.layerGroup();
        
        layerFeatures.forEach(feature => {
          try {
            const { coordinates } = feature.geometry;
            const { feature_name, domain_name } = feature.properties;
            const domainColor = domainColors[domain_name] || '#666666';
            
            // Create custom icon with domain color
            const customIcon = L.divIcon({
              className: 'custom-marker',
              html: `<div style="background-color: ${domainColor}; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; box-shadow: 0 1px 3px rgba(0,0,0,0.3);"></div>`,
              iconSize: [12, 12],
              iconAnchor: [6, 6]
            });
            
            const marker = L.marker([coordinates[1], coordinates[0]], {
              icon: customIcon
            });
            
            // Add popup with feature information
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
            
            layerGroup.addLayer(marker);
          } catch (error) {
            console.warn('Error creating marker for feature:', error);
          }
        });
        
        // Add layer group to map and store reference
        if (layerGroup.getLayers().length > 0) {
          layerGroup.addTo(mapInstanceRef.current);
          markersRef.current[layerName] = layerGroup;
        }
      });
      
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
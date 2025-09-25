import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import LayerToggle from './LayerToggle';
import '../styles/Sidebar.css';

const Sidebar = ({ 
  selectedCity, 
  availableLayers, 
  activeLayers, 
  onLayerToggle, 
  domainColors 
}) => {
  const [expandedDomains, setExpandedDomains] = useState(new Set());

  // Layer definitions with icons
  const layerDefinitions = useMemo(() => ({
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
      { name: 'theme_parks', icon: 'fas fa-ferris-wheel' },
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
  }), []);

  // Domain icons mapping
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

  // Get available layers organized by domain
  const availableLayersByDomain = useMemo(() => {
    const layersByDomain = {};
    
    Object.entries(layerDefinitions).forEach(([domain, layers]) => {
      const availableDomainLayers = layers.filter(layer => 
        availableLayers[layer.name]
      );
      
      if (availableDomainLayers.length > 0) {
        layersByDomain[domain] = availableDomainLayers;
      }
    });
    
    return layersByDomain;
  }, [layerDefinitions, availableLayers]);

  // Auto-expand domains that have available layers when city changes
  useEffect(() => {
    if (selectedCity && Object.keys(availableLayersByDomain).length > 0) {
      setExpandedDomains(new Set(Object.keys(availableLayersByDomain)));
    }
  }, [selectedCity?.name, availableLayersByDomain]); // Use selectedCity.name to prevent object reference issues

  const toggleDomain = (domain) => {
    const newExpanded = new Set(expandedDomains);
    if (newExpanded.has(domain)) {
      newExpanded.delete(domain);
    } else {
      newExpanded.add(domain);
    }
    setExpandedDomains(newExpanded);
  };

  const formatDomainName = (domain) => {
    return domain.charAt(0).toUpperCase() + domain.slice(1);
  };

  if (!selectedCity) {
    return (
      <div className="sidebar">
        <div className="sidebar-header">
          <i className="fas fa-layers"></i>
          <h2>Data Layers</h2>
        </div>
        
        <div className="no-layers-message">
          <i className="fas fa-map-marked-alt"></i>
          <h3>No City Selected</h3>
          <p>Select a city from the header to view available data layers.</p>
        </div>
      </div>
    );
  }

  const hasAvailableLayers = Object.keys(availableLayersByDomain).length > 0;

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <i className="fas fa-layers"></i>
        <h2>Data Layers</h2>
        <div className="city-indicator">
          {selectedCity.name}
        </div>
      </div>
      
      <div className="layers-container">
        {!hasAvailableLayers ? (
          <div className="no-layers-message">
            <i className="fas fa-clock"></i>
            <h3>Processing Data</h3>
            <p>Data layers are being processed for this city. Please check back in a few minutes.</p>
          </div>
        ) : (
          Object.entries(availableLayersByDomain).map(([domain, layers]) => (
            <div key={domain} className="domain-section">
              <motion.div
                className="domain-header"
                onClick={() => toggleDomain(domain)}
                whileHover={{ backgroundColor: 'rgba(0, 0, 0, 0.03)' }}
              >
                <div className="domain-info">
                  <i 
                    className={domainIcons[domain]} 
                    style={{ color: domainColors[domain] || '#666666' }}
                  />
                  <span className="domain-name">{formatDomainName(domain)}</span>
                  <span className="layer-count">{layers.length}</span>
                </div>
                <motion.i
                  className={`fas fa-chevron-${expandedDomains.has(domain) ? 'up' : 'down'}`}
                  animate={{ 
                    rotate: expandedDomains.has(domain) ? 180 : 0 
                  }}
                  transition={{ duration: 0.2 }}
                />
              </motion.div>
              
              <AnimatePresence>
                {expandedDomains.has(domain) && (
                  <motion.div
                    className="layers-list"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    {layers.map((layer) => (
                      <LayerToggle
                        key={layer.name}
                        layer={layer}
                        domainColor={domainColors[domain] || '#666666'}
                        isActive={!!activeLayers[layer.name]}
                        onToggle={(isActive) => onLayerToggle(layer.name, isActive)}
                      />
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default Sidebar;
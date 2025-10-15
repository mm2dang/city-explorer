import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import LayerToggle from './LayerToggle';
import LayerModal from './LayerModal';
import { exportLayer, exportAllLayers } from '../utils/exportUtils';
import '../styles/Sidebar.css';

const Sidebar = ({
  selectedCity,
  cityBoundary,
  availableLayers,
  activeLayers,
  onLayerToggle,
  domainColors,
  onLayerSave,
  onLayerDelete
}) => {
  const [expandedDomains, setExpandedDomains] = useState(new Set());
  const [isAddLayerModalOpen, setIsAddLayerModalOpen] = useState(false);
  const [editingLayer, setEditingLayer] = useState(null);
  const [selectedDomain, setSelectedDomain] = useState(null);
  const [exportingLayer, setExportingLayer] = useState(null);
  const [showExportAllMenu, setShowExportAllMenu] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // Close export all menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showExportAllMenu && !event.target.closest('.bulk-export-wrapper')) {
        setShowExportAllMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showExportAllMenu]);

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

    // Initialize all domains with empty arrays
    Object.keys(layerDefinitions).forEach(domain => {
      layersByDomain[domain] = [];
    });

    // Add available layers from definitions
    Object.entries(layerDefinitions).forEach(([domain, layers]) => {
      const availableDomainLayers = layers.filter(layer =>
        availableLayers[layer.name]
      );
      layersByDomain[domain] = availableDomainLayers;
    });

    // Add custom layers that aren't in layerDefinitions
    Object.keys(availableLayers).forEach(layerName => {
      const layer = availableLayers[layerName];
      if (layer && layer.domain) {
        const domain = layer.domain;
        const isInDefinitions = layerDefinitions[domain]?.some(l => l.name === layerName);

        if (!isInDefinitions) {
          // This is a custom layer
          if (!layersByDomain[domain]) {
            layersByDomain[domain] = [];
          }

          // Check if not already added
          if (!layersByDomain[domain].some(l => l.name === layerName)) {
            layersByDomain[domain].push({
              name: layerName,
              icon: layer.icon || 'fas fa-map-marker-alt'
            });
          }
        }
      }
    });

    return layersByDomain;
  }, [layerDefinitions, availableLayers]);

  // Get only domains with layers for collapsed view
  const domainsWithLayers = useMemo(() => {
    const filtered = {};
    Object.entries(availableLayersByDomain).forEach(([domain, layers]) => {
      if (layers.length > 0) {
        filtered[domain] = layers;
      }
    });
    return filtered;
  }, [availableLayersByDomain]);

  // Auto-expand domains that have available layers when city changes
  useEffect(() => {
    if (selectedCity && Object.keys(availableLayersByDomain).length > 0) {
      setExpandedDomains(new Set(Object.keys(availableLayersByDomain)));
    }
  }, [selectedCity, availableLayersByDomain]);

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

  const handleAddLayer = (domain) => {
    setSelectedDomain(domain);
    setEditingLayer(null);
    setIsAddLayerModalOpen(true);
  };

  const handleEditLayer = (domain, layer) => {
    setSelectedDomain(domain);
    setEditingLayer(layer);
    setIsAddLayerModalOpen(true);
  };

  const handleDeleteLayer = async (domain, layerName) => {
    if (window.confirm(`Are you sure you want to delete the layer "${layerName.replace(/_/g, ' ')}"? This action cannot be undone.`)) {
      try {
        await onLayerDelete(domain, layerName);
      } catch (error) {
        alert(`Failed to delete layer: ${error.message}`);
      }
    }
  };

  const handleExportLayer = async (domain, layerName, format) => {
    try {
      setExportingLayer(layerName);
      await exportLayer(selectedCity.name, domain, layerName, format);
    } catch (error) {
      alert(`Failed to export layer: ${error.message}`);
    } finally {
      setExportingLayer(null);
    }
  };

  const handleModalSave = async (layerData) => {
    try {
      await onLayerSave(layerData);
      setIsAddLayerModalOpen(false);
      setEditingLayer(null);
      setSelectedDomain(null);
    } catch (error) {
      alert(`Failed to save layer: ${error.message}`);
    }
  };

  const handleExportAll = async (format) => {
    if (!window.confirm(`Export all layers as ${format.toUpperCase()}? This may take a few minutes.`)) return;

    try {
      setExportingLayer('all');
      setShowExportAllMenu(false);
      await exportAllLayers(selectedCity.name, availableLayersByDomain, format);
      alert('All layers exported successfully!');
    } catch (error) {
      alert(`Failed to export all layers: ${error.message}`);
    } finally {
      setExportingLayer(null);
    }
  };

  const handleDeleteAll = async () => {
    if (!window.confirm('Delete ALL layers? This action cannot be undone.')) return;
    if (!window.confirm('Are you absolutely sure? All layer data will be permanently deleted.')) return;

    try {
      for (const [domain, layers] of Object.entries(availableLayersByDomain)) {
        for (const layer of layers) {
          await onLayerDelete(domain, layer.name);
        }
      }
      alert('All layers deleted successfully!');
    } catch (error) {
      alert(`Failed to delete all layers: ${error.message}`);
    }
  };

  const handleToggleDomainLayers = (domain, layers) => {
    // Check if all layers in this domain are currently active
    const allActive = layers.every(layer => activeLayers[layer.name]);
    
    // Determine the new state: if all are active, turn all off; otherwise turn all on
    const newState = !allActive;
    
    console.log(`Toggling domain ${domain}: ${layers.length} layers to ${newState}`);
    
    // Toggle all layers in the domain to the new state
    layers.forEach((layer) => {
      onLayerToggle(layer.name, newState);
    });
  };

  if (!selectedCity) {
    return (
      <div className="sidebar">
        <div className="sidebar-header">
          <div className="header-content">
            <div className="header-text">
              <h2>Data Layers</h2>
            </div>
          </div>
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
  const totalLayers = Object.values(availableLayersByDomain).reduce((sum, layers) => sum + layers.length, 0);
  const activeLayersCount = Object.values(activeLayers).filter(Boolean).length;

  return (
    <motion.div
      className={`sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}
      animate={{ width: isSidebarCollapsed ? 80 : 360 }}
      transition={{ duration: 0.3 }}
    >
      <div className="sidebar-header">
        <div className="header-content">
          {!isSidebarCollapsed && (
            <div className="header-text">
              <h2>Data Layers</h2>
            </div>
          )}
          <div className="city-indicator">
            <i className="fas fa-map-pin"></i>
            {selectedCity.name}
          </div>
        </div>
        <motion.button
          className="collapse-toggle-btn"
          onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95 }}
          title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <i className={`fas fa-chevron-${isSidebarCollapsed ? 'right' : 'left'}`}></i>
        </motion.button>
      </div>

      <div className="layers-container">
        {isSidebarCollapsed ? (
          // Collapsed view - show icons only
          <div className="collapsed-layers-view">
            {Object.keys(domainsWithLayers).length > 0 && Object.entries(domainsWithLayers).map(([domain, layers]) => {
              const allActive = layers.every(layer => activeLayers[layer.name]);
              const someActive = layers.some(layer => activeLayers[layer.name]);
              
              return (
                <motion.div
                  key={domain}
                  className={`collapsed-domain-icon ${allActive ? 'all-active' : someActive ? 'some-active' : ''}`}
                  title={`${formatDomainName(domain)} (${layers.length}) - Click to toggle`}
                  onClick={() => handleToggleDomainLayers(domain, layers)}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <div
                    className="collapsed-icon-wrapper"
                    style={{ backgroundColor: `${domainColors[domain]}15` }}
                  >
                    <i
                      className={domainIcons[domain]}
                      style={{ color: domainColors[domain] }}
                    />
                  </div>
                  <span className="collapsed-count">{layers.length}</span>
                </motion.div>
              );
            })}
          </div>
        ) : (
          // Expanded view - full content
          <>
            {!hasAvailableLayers ? (
              <div className="no-layers-message">
                <i className="fas fa-clock"></i>
                <h3>Processing Data</h3>
                <p>Data layers are being processed for this city. Please check back in a few minutes.</p>
              </div>
            ) : (
              <>
                <div className="layers-stats-section">
                  <div className="layers-summary">
                    <div className="summary-item">
                      <span className="summary-label">Active</span>
                      <span className="summary-value">{activeLayersCount}</span>
                    </div>
                    <div className="summary-divider"></div>
                    <div className="summary-item">
                      <span className="summary-label">Available</span>
                      <span className="summary-value">{totalLayers}</span>
                    </div>
                  </div>
                  <div className="bulk-actions">
                    <div className="bulk-export-wrapper">
                      <button
                        className="bulk-action-btn export"
                        onClick={() => setShowExportAllMenu(!showExportAllMenu)}
                        disabled={exportingLayer === 'all'}
                      >
                        <i className="fas fa-download"></i>
                        {exportingLayer === 'all' ? 'Exporting...' : 'Export All'}
                      </button>
                      {showExportAllMenu && (
                        <div className="export-dropdown">
                          <button
                            className="export-option"
                            onClick={() => handleExportAll('parquet')}
                          >
                            <i className="fas fa-database"></i>
                            <span className="format-label">Parquet</span>
                            <span className="format-ext">.parquet</span>
                          </button>
                          <button
                            className="export-option"
                            onClick={() => handleExportAll('csv')}
                          >
                            <i className="fas fa-file-csv"></i>
                            <span className="format-label">CSV</span>
                            <span className="format-ext">.csv</span>
                          </button>
                          <button
                            className="export-option"
                            onClick={() => handleExportAll('geojson')}
                          >
                            <i className="fas fa-map-marked-alt"></i>
                            <span className="format-label">GeoJSON</span>
                            <span className="format-ext">.geojson</span>
                          </button>
                          <button
                            className="export-option"
                            onClick={() => handleExportAll('shapefile')}
                          >
                            <i className="fas fa-layer-group"></i>
                            <span className="format-label">Shapefile</span>
                            <span className="format-ext">.shp</span>
                          </button>
                        </div>
                      )}
                    </div>
                    <button
                      className="bulk-action-btn delete"
                      onClick={handleDeleteAll}
                    >
                      <i className="fas fa-trash-alt"></i>
                      Delete All
                    </button>
                  </div>
                </div>
                <div className="layers-scroll-content">
                  {Object.entries(availableLayersByDomain).map(([domain, layers]) => (
                    <div key={domain} className="domain-section">
                      <motion.div
                        className="domain-header"
                        onClick={() => toggleDomain(domain)}
                        whileHover={{ backgroundColor: 'rgba(0, 0, 0, 0.03)' }}
                      >
                        <div className="domain-info">
                          <div
                            className="domain-icon-wrapper"
                            style={{ backgroundColor: `${domainColors[domain]}15` }}
                          >
                            <i
                              className={domainIcons[domain]}
                              style={{ color: domainColors[domain] }}
                            />
                          </div>
                          <span className="domain-name">{formatDomainName(domain)}</span>
                          <span className="layer-count">{layers.length}</span>
                        </div>
                        <div className="domain-actions">
                          <button
                            className="add-layer-icon-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAddLayer(domain);
                            }}
                            title="Add layer to this domain"
                          >
                            <i className="fas fa-plus"></i>
                          </button>
                          <motion.i
                            className={`fas fa-chevron-${expandedDomains.has(domain) ? 'up' : 'down'}`}
                            animate={{
                              rotate: expandedDomains.has(domain) ? 180 : 0
                            }}
                            transition={{ duration: 0.2 }}
                          />
                        </div>
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
                                domainColor={domainColors[domain]}
                                isActive={!!activeLayers[layer.name]}
                                onToggle={(isActive) => onLayerToggle(layer.name, isActive)}
                                onEdit={() => handleEditLayer(domain, layer)}
                                onDelete={() => handleDeleteLayer(domain, layer.name)}
                                onExport={(format) => handleExportLayer(domain, layer.name, format)}
                                isExporting={exportingLayer === layer.name}
                              />
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      <LayerModal
        isOpen={isAddLayerModalOpen}
        onClose={() => {
          setIsAddLayerModalOpen(false);
          setEditingLayer(null);
          setSelectedDomain(null);
        }}
        editingLayer={editingLayer}
        domain={selectedDomain}
        domainColor={selectedDomain ? domainColors[selectedDomain] : '#666666'}
        existingLayers={selectedDomain ? availableLayersByDomain[selectedDomain] || [] : []}
        onSave={handleModalSave}
        cityBoundary={cityBoundary}
        cityName={selectedCity?.name}
      />
    </motion.div>
  );
};

export default Sidebar;
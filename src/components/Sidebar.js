import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import LayerToggle from './LayerToggle';
import LayerModal from './LayerModal';
import { exportLayer, exportAllLayers } from '../utils/exportUtils';
import { loadLayerForEditing } from '../utils/s3';
import '../styles/Sidebar.css';

const Sidebar = ({
  selectedCity,
  cityBoundary,
  availableLayers,
  activeLayers,
  onLayerToggle,
  domainColors,
  onLayerSave,
  onLayerDelete,
  mapView = 'street'
}) => {
  const [expandedDomains, setExpandedDomains] = useState(new Set());
  const [isAddLayerModalOpen, setIsAddLayerModalOpen] = useState(false);
  const [editingLayer, setEditingLayer] = useState(null);
  const [selectedDomain, setSelectedDomain] = useState(null);
  const [exportingLayer, setExportingLayer] = useState(null);
  const [showExportAllMenu, setShowExportAllMenu] = useState(false);
  const [exportingDomain, setExportingDomain] = useState(null);
  const [showDomainExportMenu, setShowDomainExportMenu] = useState(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [openLayerExport, setOpenLayerExport] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Close export menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showExportAllMenu && !event.target.closest('.bulk-export-wrapper')) {
        setShowExportAllMenu(false);
      }
      if (showDomainExportMenu && !event.target.closest('.domain-export-wrapper')) {
        setShowDomainExportMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showExportAllMenu, showDomainExportMenu]);

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
    Object.keys(layerDefinitions).forEach(domain => {
      layersByDomain[domain] = [];
    });
    Object.entries(layerDefinitions).forEach(([domain, layers]) => {
      const availableDomainLayers = layers.filter(layer => {
        const isAvailable = availableLayers[layer.name];
        if (!isAvailable) {
          console.warn(`Layer ${layer.name} not found in availableLayers`);
        }
        return isAvailable;
      });
      layersByDomain[domain] = availableDomainLayers;
    });
    Object.keys(availableLayers).forEach(layerName => {
      const layer = availableLayers[layerName];
      if (layer && layer.domain) {
        const domain = layer.domain;
        const isInDefinitions = layerDefinitions[domain]?.some(l => l.name === layerName);
        if (!isInDefinitions) {
          if (!layersByDomain[domain]) {
            layersByDomain[domain] = [];
          }
          if (!layersByDomain[domain].some(l => l.name === layerName)) {
            if (!layerName || layerName === domain) {
              console.error(`Invalid layer name detected: ${layerName} for domain ${domain}`);
              return;
            }
            layersByDomain[domain].push({
              name: layerName,
              icon: layer.icon || 'fas fa-map-marker-alt'
            });
          }
        }
      } else {
        console.warn(`Invalid layer data for ${layerName}:`, layer);
      }
    });
    console.log('Computed availableLayersByDomain:', layersByDomain);
    return layersByDomain;
  }, [layerDefinitions, availableLayers]);

  // Get only domains with layers for collapsed view
  const domainsWithLayers = useMemo(() => {
    const filtered = {};
    Object.entries(availableLayersByDomain).forEach(([domain, layers]) => {
      if (layers.length > 0) {
        filtered[domain] = layers.sort((a, b) => a.name.localeCompare(b.name));
      }
    });
    return filtered;
  }, [availableLayersByDomain]);

  // Filter and sort domains/layers based on search query
  const filteredAndSortedDomains = useMemo(() => {
    const filtered = {};
    const query = searchQuery.toLowerCase().trim();
    
    Object.entries(availableLayersByDomain).forEach(([domain, layers]) => {
      if (layers.length === 0) return; // Skip domains with no layers
      
      const domainMatches = domain.toLowerCase().includes(query);
      const matchingLayers = layers.filter(layer => 
        layer.name.toLowerCase().includes(query) || domainMatches
      ).sort((a, b) => a.name.localeCompare(b.name));
      
      if (matchingLayers.length > 0) {
        filtered[domain] = matchingLayers;
      }
    });
    
    // Sort domains alphabetically
    return Object.keys(filtered)
      .sort((a, b) => a.localeCompare(b))
      .reduce((acc, domain) => {
        acc[domain] = filtered[domain];
        return acc;
      }, {});
  }, [availableLayersByDomain, searchQuery]);

  // Auto-expand domains that have available layers when city changes or search query changes
  useEffect(() => {
    if (selectedCity && Object.keys(filteredAndSortedDomains).length > 0) {
      setExpandedDomains(new Set(Object.keys(filteredAndSortedDomains)));
    }
  }, [selectedCity, filteredAndSortedDomains]);

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
    if (!domain || !layer || !layer.name) {
      console.error('Invalid edit parameters:', { domain, layer });
      alert('Cannot edit layer: missing parameters');
      return;
    }
    
    console.log(`Editing layer: domain="${domain}", layerName="${layer.name}"`);
    setSelectedDomain(domain);
    setEditingLayer(layer);
    setIsAddLayerModalOpen(true);
  };

  const handleDeleteLayer = async (domain, layerName) => {
    if (!domain || !layerName) {
      console.error('Invalid delete parameters:', { domain, layerName });
      alert('Cannot delete layer: missing domain or layer name');
      return;
    }
  
    const displayName = layerName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  
    if (window.confirm(`Are you sure you want to delete "${displayName}" from ${domain}?`)) {
      try {
        // Turn off layer visibility before deleting
        if (activeLayers[layerName]) {
          onLayerToggle(layerName, false);
        }
  
        await onLayerDelete(domain, layerName);
      } catch (error) {
        console.error('Failed to delete layer:', error);
        alert(`Failed to delete layer: ${error.message}`);
      }
    }
  };

  const handleDeleteDomain = async (domain, layers) => {
  const domainName = formatDomainName(domain);
  if (window.confirm(`Delete all ${layers.length} layer(s) in ${domainName}? This action cannot be undone.`)) {
    try {
      // Turn off all layers in domain first
      layers.forEach(layer => {
        if (activeLayers[layer.name]) {
          onLayerToggle(layer.name, false);
        }
      });

      for (const layer of layers) {
        await onLayerDelete(domain, layer.name, { silent: true });
      }
      alert(`${domainName} layers deleted successfully!`);
    } catch (error) {
      alert(`Failed to delete domain layers: ${error.message}`);
    }
  }
};

  const handleExportLayer = async (domain, layerName, format) => {
    if (!domain || !layerName || !format) {
      console.error('Invalid export parameters:', { domain, layerName, format });
      alert('Cannot export layer: missing required parameters');
      return;
    }
    
    if (!selectedCity || !selectedCity.name) {
      console.error('No city selected for export');
      alert('Please select a city before exporting');
      return;
    }
    
    try {
      console.log(`Exporting layer: domain="${domain}", layer="${layerName}", format="${format}"`);
      setExportingLayer(layerName);
      
      // Load features using the existing loadLayerForEditing function
      const features = await loadLayerForEditing(selectedCity.name, domain, layerName);
      
      if (!features || features.length === 0) {
        throw new Error(`No features found for layer "${layerName}"`);
      }
      
      console.log(`Loaded ${features.length} features for export`);
      
      // Convert GeoJSON features to the format expected by export functions
      const exportData = features.map(feature => ({
        // Store geometry as JSON string
        geometry_coordinates: JSON.stringify(feature.geometry),
        geometry_type: feature.geometry?.type || 'Unknown',
        
        // Add lat/lon for point features
        ...(feature.geometry?.type === 'Point' && {
          longitude: feature.geometry.coordinates[0],
          latitude: feature.geometry.coordinates[1]
        }),
        
        // Include all properties
        ...feature.properties,
        
        // Ensure required fields
        name: feature.properties?.name || feature.properties?.feature_name || 'Unnamed',
        feature_name: feature.properties?.name || feature.properties?.feature_name || 'Unnamed',
        layer_name: layerName,
        domain_name: domain
      }));
      
      // Pass preloaded data to exportLayer (5th parameter)
      await exportLayer(selectedCity.name, domain, layerName, format, exportData);
      
      console.log('Export completed successfully');
    } catch (error) {
      console.error('Export failed:', error);
      alert(`Failed to export layer: ${error.message}`);
    } finally {
      setExportingLayer(null);
    }
  };
  
  const handleModalSave = async (layerData) => {
    try {
      // Save the layer (adds it to availableLayers, etc.)
      await onLayerSave(layerData);
      
      // Automatically toggle the new layer ON
      // Use setTimeout to ensure state has updated after save (e.g., if onLayerSave is async and updates parent state)
      setTimeout(() => {
        onLayerToggle(layerData.name, true);
        console.log(`Automatically enabled new layer: ${layerData.name}`);
      }, 0);
      
      // Close modal and reset
      setIsAddLayerModalOpen(false);
      setEditingLayer(null);
      setSelectedDomain(null);
    } catch (error) {
      alert(`Failed to save layer: ${error.message}`);
    }
  };

  const handleExportAll = async (format) => {
    if (!window.confirm(`Export all layers as ${format.toUpperCase()}?`)) return;

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

  const handleExportDomain = async (domain, layers, format) => {
    const domainName = formatDomainName(domain);
    if (!window.confirm(`Export all ${layers.length} layer(s) in ${domainName} as ${format.toUpperCase()}?`)) return;

    try {
      setExportingDomain(domain);
      setShowDomainExportMenu(null);
      
      // Create a filtered version with only this domain
      const domainLayers = { [domain]: layers };
      await exportAllLayers(selectedCity.name, domainLayers, format);
      alert(`${domainName} layers exported successfully!`);
    } catch (error) {
      alert(`Failed to export ${domainName} layers: ${error.message}`);
    } finally {
      setExportingDomain(null);
    }
  };

  const handleDeleteAll = async () => {
    const totalLayers = Object.values(availableLayersByDomain).reduce((sum, layers) => sum + layers.length, 0);
    if (window.confirm(`Delete ALL ${totalLayers} layers across all domains? This action cannot be undone.`)) {
      try {
        // Turn off all active layers first
        Object.keys(activeLayers).forEach(layerName => {
          if (activeLayers[layerName]) {
            onLayerToggle(layerName, false);
          }
        });
  
        for (const [domain, layers] of Object.entries(availableLayersByDomain)) {
          for (const layer of layers) {
            await onLayerDelete(domain, layer.name, { silent: true });
          }
        }
        alert('All layers deleted successfully!');
      } catch (error) {
        alert(`Failed to delete all layers: ${error.message}`);
      }
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
  const activeLayersCount = Object.entries(activeLayers).filter(([layerName, isActive]) => isActive && availableLayers[layerName]).length;

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
                  <div className="search-container">
                    <i className="fas fa-search search-icon"></i>
                    <input
                      type="text"
                      className="search-input"
                      placeholder="Search layers or domains..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    {searchQuery && (
                      <button
                        className="clear-search-btn"
                        onClick={() => setSearchQuery('')}
                        title="Clear search"
                      >
                        <i className="fas fa-times"></i>
                      </button>
                    )}
                  </div>
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
                    <button
                      className="bulk-action-btn add"
                      onClick={() => handleAddLayer(null)}
                    >
                      <i className="fas fa-plus"></i>
                      Add Layer
                    </button>
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
                  {Object.keys(filteredAndSortedDomains).length === 0 ? (
                    <div className="no-results-message">
                      <i className="fas fa-search"></i>
                      <h3>No Results</h3>
                      <p>No layers or domains match "{searchQuery}"</p>
                    </div>
                  ) : (
                    Object.entries(filteredAndSortedDomains).map(([domain, layers]) => {
                      const allActive = layers.every(layer => activeLayers[layer.name]);
                      const someActive = layers.some(layer => activeLayers[layer.name]);
                      const isExpanded = expandedDomains.has(domain);
                      
                      return (
                        <div 
                          key={domain} 
                          className={`domain-section ${openLayerExport && openLayerExport.startsWith(domain) && layers[0].name === openLayerExport.split('-')[1] ? 'first-layer-export-open' : ''}`}
                        >
                          <motion.div
                            className={`domain-header ${isExpanded ? 'expanded' : ''} ${allActive ? 'all-active' : someActive ? 'some-active' : ''}`}
                            style={{
                              backgroundColor: allActive 
                                ? `${domainColors[domain]}10` 
                                : someActive 
                                ? `${domainColors[domain]}05` 
                                : 'transparent'
                            }}
                          >
                            <div 
                              className="domain-main-area"
                              onClick={() => toggleDomain(domain)}
                            >
                              <motion.button
                                className={`domain-checkbox ${allActive ? 'checked' : someActive ? 'indeterminate' : ''}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleDomainLayers(domain, layers);
                                }}
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                              >
                                {allActive ? (
                                  <i className="fas fa-check" style={{ color: domainColors[domain] }}></i>
                                ) : someActive ? (
                                  <i className="fas fa-minus" style={{ color: domainColors[domain] }}></i>
                                ) : null}
                              </motion.button>
                              
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
                            </div>
                            <div className="domain-actions">
                              <button
                                className="domain-action-icon-btn add"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAddLayer(domain);
                                }}
                                title="Add layer"
                              >
                                <i className="fas fa-plus"></i>
                              </button>
                              <div className="domain-export-wrapper">
                                <button
                                  className="domain-action-icon-btn export"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setShowDomainExportMenu(showDomainExportMenu === domain ? null : domain);
                                  }}
                                  title="Export all layers in domain"
                                  disabled={exportingDomain === domain}
                                >
                                  <i className={`fas ${exportingDomain === domain ? 'fa-spinner fa-spin' : 'fa-download'}`}></i>
                                </button>
                                {showDomainExportMenu === domain && (
                                  <div className="export-dropdown domain-export-dropdown">
                                    <button
                                      className="export-option"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleExportDomain(domain, layers, 'parquet');
                                      }}
                                    >
                                      <i className="fas fa-database"></i>
                                      <span className="format-label">Parquet</span>
                                      <span className="format-ext">.parquet</span>
                                    </button>
                                    <button
                                      className="export-option"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleExportDomain(domain, layers, 'csv');
                                      }}
                                    >
                                      <i className="fas fa-file-csv"></i>
                                      <span className="format-label">CSV</span>
                                      <span className="format-ext">.csv</span>
                                    </button>
                                    <button
                                      className="export-option"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleExportDomain(domain, layers, 'geojson');
                                      }}
                                    >
                                      <i className="fas fa-map-marked-alt"></i>
                                      <span className="format-label">GeoJSON</span>
                                      <span className="format-ext">.geojson</span>
                                    </button>
                                    <button
                                      className="export-option"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleExportDomain(domain, layers, 'shapefile');
                                      }}
                                    >
                                      <i className="fas fa-layer-group"></i>
                                      <span className="format-label">Shapefile</span>
                                      <span className="format-ext">.shp</span>
                                    </button>
                                  </div>
                                )}
                              </div>
                              <button
                                className="domain-action-icon-btn delete"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteDomain(domain, layers);
                                }}
                                title="Delete all layers in domain"
                              >
                                <i className="fas fa-trash"></i>
                              </button>
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
                                    onExportMenuOpen={() => setOpenLayerExport(`${domain}-${layer.name}`)}
                                    onExportMenuClose={() => setOpenLayerExport(null)}
                                  />
                                ))}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      );
                    })
                  )}
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
        domainColors={domainColors}
        availableLayersByDomain={availableLayersByDomain} 
        mapView={mapView}
      />
    </motion.div>
  );
};

export default Sidebar;
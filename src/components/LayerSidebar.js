import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import LayerToggle from './LayerToggle';
import LayerModal from './LayerModal';
import { exportLayer, exportAllLayers } from '../utils/exportUtils';
import { loadLayerForEditing, processCityFeatures } from '../utils/s3';
import '../styles/LayerSidebar.css';

const LayerSidebar = ({
  selectedCity,
  cityBoundary,
  availableLayers,
  activeLayers,
  onLayerToggle,
  domainColors,
  onLayerSave,
  onLayerDelete,
  mapView = 'street',
  onImportComplete,
  onCityStatusChange,
  dataSource = 'osm',
  onCitySelect,
  cities = [],
  cityDataStatus = {},
  processingProgress = {},
  isSidebarCollapsed,
  onToggleCollapse
}) => {
  const [expandedDomains, setExpandedDomains] = useState(new Set());
  const [isAddLayerModalOpen, setIsAddLayerModalOpen] = useState(false);
  const [editingLayer, setEditingLayer] = useState(null);
  const [selectedDomain, setSelectedDomain] = useState(null);
  const [exportingLayer, setExportingLayer] = useState(null);
  const [showExportAllMenu, setShowExportAllMenu] = useState(false);
  const [exportingDomain, setExportingDomain] = useState(null);
  const [showDomainExportMenu, setShowDomainExportMenu] = useState(null);
  const [openLayerExport, setOpenLayerExport] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [importingCities, setImportingCities] = useState(new Set());
  const [dropdownPositions, setDropdownPositions] = useState({});

  // Close export menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showExportAllMenu) {
        const exportWrapper = document.querySelector('.bulk-export-wrapper');
        const exportDropdown = document.querySelector('.bulk-export-wrapper .export-dropdown');
        if (exportWrapper && !exportWrapper.contains(event.target) && 
            (!exportDropdown || !exportDropdown.contains(event.target))) {
          setShowExportAllMenu(false);
        }
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

  const statusCounts = useMemo(() => ({
    ready: Object.entries(cityDataStatus).filter(([_, hasData]) => hasData).length,
    processing: Object.keys(processingProgress).filter(key => {
      const progress = processingProgress[key];
      return progress && progress.status === 'processing';
    }).length,
    pending: cities.length - Object.entries(cityDataStatus).filter(([_, hasData]) => hasData).length - Object.keys(processingProgress).filter(key => {
      const progress = processingProgress[key];
      return progress && progress.status === 'processing';
    }).length
  }), [cities, cityDataStatus, processingProgress]);

  // Get available layers organized by domain
  const availableLayersByDomain = useMemo(() => {
    const layersByDomain = {};
    Object.keys(layerDefinitions).forEach(domain => {
      layersByDomain[domain] = [];
    });
    Object.entries(layerDefinitions).forEach(([domain, layers]) => {
      const availableDomainLayers = layers.filter(layer => {
        const isAvailable = availableLayers[layer.name];
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
    setSelectedDomain(domain);
    setEditingLayer(layer);
    setIsAddLayerModalOpen(true);
  };

  const handleDeleteLayer = async (domain, layerName, options = {}) => {
    if (!domain || !layerName) {
      console.error('Invalid delete parameters:', { domain, layerName });
      alert('Cannot delete layer: missing domain or layer name');
      return;
    }
  
    const displayName = layerName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  
    if (!options.silent && !window.confirm(`Are you sure you want to delete "${displayName}" from ${domain}?`)) {
      return;
    }
  
    try {
      // Turn off layer visibility before deleting
      if (activeLayers[layerName]) {
        onLayerToggle(layerName, false);
      }
  
      await onLayerDelete(domain, layerName);
      
      // Check if this was the last layer - if so, notify parent to update city status
      const remainingLayers = Object.keys(availableLayers).filter(name => name !== layerName);
      if (remainingLayers.length === 0 && onCityStatusChange) {
        onCityStatusChange(selectedCity.name, false);
      }
    } catch (error) {
      console.error('Failed to delete layer:', error);
      alert(`Failed to delete layer: ${error.message}`);
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
        
        // Check if this was the last domain with layers
        const remainingDomains = Object.keys(availableLayersByDomain).filter(d => {
          if (d === domain) return false;
          return availableLayersByDomain[d].length > 0;
        });
        
        if (remainingDomains.length === 0 && onCityStatusChange) {
          onCityStatusChange(selectedCity.name, false);
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
      setExportingLayer(layerName);
      
      // Load features using the existing loadLayerForEditing function
      const features = await loadLayerForEditing(selectedCity.name, domain, layerName);
      
      if (!features || features.length === 0) {
        throw new Error(`No features found for layer "${layerName}"`);
      }
      
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
    } catch (error) {
      console.error('Export failed:', error);
      alert(`Failed to export layer: ${error.message}`);
    } finally {
      setExportingLayer(null);
    }
  };
  
  const handleModalSave = async (layerData) => {
    try {
      // Check if this is an edit with changes
      if (layerData.isEdit && (layerData.layerNameChanged || layerData.domainChanged)) {        
        // Delete the old layer
        await onLayerDelete(layerData.originalDomain, layerData.originalName, { silent: true });
      }
      
      // Save the layer (either new or with new name/domain)
      await onLayerSave(layerData);
      
      // Automatically toggle the layer ON
      setTimeout(() => {
        onLayerToggle(layerData.name, true);
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
        
        // Update city status to pending
        if (onCityStatusChange) {
          onCityStatusChange(selectedCity.name, false);
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
    
    // Toggle all layers in the domain to the new state
    layers.forEach((layer) => {
      onLayerToggle(layer.name, newState);
    });
  };

  const handleImportFromOSM = async () => {
    if (!selectedCity) {
      alert('No city selected');
      return;
    }
  
    // CAPTURE the current data source to prevent race conditions
    const targetDataSource = dataSource;
    const processingKey = `${selectedCity.name}@${targetDataSource}`;
  
    // Check if this city is already being imported IN THIS DATA SOURCE
    if (importingCities.has(processingKey)) {
      alert(`Import already in progress for ${selectedCity.name} in ${targetDataSource} data source`);
      return;
    }
  
    if (!window.confirm(
      `Import all layers from OpenStreetMap for ${selectedCity.name} into ${targetDataSource} data source?\n\n` +
      'This may take several minutes depending on city size.\n\n'
    )) {
      return;
    }
  
    // Mark this city+datasource as importing
    setImportingCities(prev => new Set([...prev, processingKey]));
  
    // Store city info before we deselect
    const cityToImport = selectedCity;

    // Deselect the city BEFORE starting processing
    if (onCitySelect) {
      onCitySelect(null);
    }
  
    try {
      // Parse city name to extract components
      const parts = cityToImport.name.split(',').map(p => p.trim());
      let city, province, country;
      
      if (parts.length === 2) {
        [city, country] = parts;
        province = '';
      } else if (parts.length >= 3) {
        city = parts[0];
        province = parts[parts.length - 2];
        country = parts[parts.length - 1];
      } else {
        throw new Error('Invalid city name format');
      }
  
      // Calculate total layers for progress tracking
      const layerDefinitions = {
        mobility: 8,
        governance: 3,
        health: 6,
        economy: 4,
        environment: 5,
        culture: 6,
        education: 4,
        housing: 2,
        social: 3
      };
      const totalLayers = Object.values(layerDefinitions).reduce((sum, count) => sum + count, 0);
  
      // Deselect the city before starting processing
      if (onImportComplete) {
        onImportComplete(cityToImport.name, {
          processed: 0,
          saved: 0,
          total: totalLayers,
          status: 'processing',
          dataSource: targetDataSource
        });
      }
  
      // Start the import asynchronously
      processCityFeatures(
        cityToImport,
        country,
        province,
        city,
        (cityName, progress) => {
          // Update progress through parent callback
          if (onImportComplete) {
            onImportComplete(cityName, {
              ...progress,
              dataSource: targetDataSource
            });
          }
        },
        targetDataSource
      ).then(() => {
        // Mark as complete and remove from processing
        if (onImportComplete) {
          onImportComplete(cityToImport.name, {
            status: 'complete',
            message: 'Import completed successfully',
            dataSource: targetDataSource
          });
        }
        
        // Remove from importing set
        setImportingCities(prev => {
          const newSet = new Set(prev);
          newSet.delete(processingKey);
          return newSet;
        });
      }).catch(error => {
        console.error('Error importing from OSM:', error);
        
        // Mark as failed
        if (onImportComplete) {
          onImportComplete(cityToImport.name, {
            status: 'failed',
            error: error.message,
            dataSource: targetDataSource
          });
        }
        
        // Remove from importing set
        setImportingCities(prev => {
          const newSet = new Set(prev);
          newSet.delete(processingKey);
          return newSet;
        });
        
        alert(`Failed to import from OSM for ${cityToImport.name} in ${targetDataSource}: ${error.message}`);
      });
  
      // Show success message immediately (import continues in background)
      alert(`Import started for ${cityToImport.name} in ${targetDataSource} data source.`);
      
    } catch (error) {
      console.error('Error starting OSM import:', error);
      
      // Mark as failed
      if (onImportComplete) {
        onImportComplete(cityToImport.name, {
          status: 'failed',
          error: error.message,
          dataSource: targetDataSource
        });
      }
      
      // Remove from importing set
      setImportingCities(prev => {
        const newSet = new Set(prev);
        newSet.delete(processingKey);
        return newSet;
      });
      
      alert(`Failed to start import from OSM: ${error.message}`);
    }
  };

  const getAllFeatures = useCallback(async () => {
    if (!selectedCity) return [];
    
    const allFeatures = [];
    
    for (const [domainName, domainLayers] of Object.entries(availableLayersByDomain)) {
      if (domainLayers.length === 0) continue;
      
      for (const layer of domainLayers) {
        try {
          const features = await loadLayerForEditing(
            selectedCity.name,
            domainName,
            layer.name
          );
          
          if (features && features.length > 0) {
            allFeatures.push(...features);
          }
        } catch (error) {
          console.warn(`Could not load features from ${domainName}/${layer.name}:`, error);
        }
      }
    }
    return allFeatures;
  }, [selectedCity, availableLayersByDomain]);

  if (!selectedCity) {
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
          </div>
          <motion.button
            className="collapse-toggle-btn"
            onClick={onToggleCollapse}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <i className={`fas fa-chevron-${isSidebarCollapsed ? 'right' : 'left'}`}></i>
          </motion.button>
        </div>
  
        {isSidebarCollapsed ? (
          // Collapsed view - show stats
          <div className="collapsed-layers-view">
            <div className="collapsed-stats-view">
              <div className="collapsed-stat-item">
                <div className="collapsed-stat-icon">
                  <i className="fas fa-check-circle" style={{ color: '#10b981' }}></i>
                </div>
                <div className="collapsed-stat-value">{statusCounts.ready}</div>
                <div className="collapsed-stat-label">Ready</div>
              </div>
              <div className="collapsed-stat-item">
                <div className="collapsed-stat-icon">
                  <i className="fas fa-spinner fa-spin" style={{ color: '#f59e0b' }}></i>
                </div>
                <div className="collapsed-stat-value">{statusCounts.processing}</div>
                <div className="collapsed-stat-label">Processing</div>
              </div>
              <div className="collapsed-stat-item">
                <div className="collapsed-stat-icon">
                  <i className="fas fa-clock" style={{ color: '#64748b' }}></i>
                </div>
                <div className="collapsed-stat-value">{statusCounts.pending}</div>
                <div className="collapsed-stat-label">Pending</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="world-view-content">
            <div className="global-stats">
              <h3>
                <i className="fas fa-globe"></i>
                Global Overview
              </h3>
              <div className="stats-grid">
                <div className="stat-card">
                  <div className="stat-value">{statusCounts.ready}</div>
                  <div className="stat-label">Ready</div>
                  <div className="stat-icon">
                    <i className="fas fa-check-circle" style={{ color: '#10b981' }}></i>
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{statusCounts.processing}</div>
                  <div className="stat-label">Processing</div>
                  <div className="stat-icon">
                    <i className="fas fa-spinner fa-spin" style={{ color: '#f59e0b' }}></i>
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{statusCounts.pending}</div>
                  <div className="stat-label">Pending</div>
                  <div className="stat-icon">
                    <i className="fas fa-clock" style={{ color: '#64748b' }}></i>
                  </div>
                </div>
              </div>
            </div>
  
            <div className="map-legend">
              <h4>
                <i className="fas fa-map-marker-alt"></i>
                Map Guide
              </h4>
              <div className="legend-items">
                <div className="legend-item">
                  <div className="legend-marker ready">
                    <i className="fas fa-city"></i>
                  </div>
                  <div className="legend-text">
                    <strong>Ready Cities</strong>
                    <small>Click to explore data layers</small>
                  </div>
                </div>
                <div className="legend-item">
                  <div className="legend-marker processing">
                    <i className="fas fa-spinner fa-spin"></i>
                  </div>
                  <div className="legend-text">
                    <strong>Processing</strong>
                    <small>Data is being imported</small>
                  </div>
                </div>
                <div className="legend-item">
                  <div className="legend-marker pending">
                    <i className="fas fa-clock"></i>
                  </div>
                  <div className="legend-text">
                    <strong>Pending</strong>
                    <small>No data layers yet</small>
                  </div>
                </div>
              </div>
            </div>
  
            <div className="getting-started">
              <h4>
                <i className="fas fa-compass"></i>
                Getting Started
              </h4>
              <ol className="steps-list">
                <li>
                  <div className="step-number">1</div>
                  <div className="step-content">
                    <strong>Select a city</strong>
                    <small>Click a marker on the map or use the dropdown above</small>
                  </div>
                </li>
                <li>
                  <div className="step-number">2</div>
                  <div className="step-content">
                    <strong>Toggle layers</strong>
                    <small>Enable data layers to visualize features</small>
                  </div>
                </li>
                <li>
                  <div className="step-number">3</div>
                  <div className="step-content">
                    <strong>Explore data</strong>
                    <small>Click markers and geometries to see details</small>
                  </div>
                </li>
              </ol>
            </div>
  
            {cities.length === 0 && (
              <div className="empty-state">
                <i className="fas fa-map-marked-alt"></i>
                <h3>No Cities Yet</h3>
                <p>Add your first city to get started exploring urban data.</p>
              </div>
            )}
          </div>
        )}
      </motion.div>
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
          onClick={onToggleCollapse}
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
                    {!selectedCity || (selectedCity && totalLayers === 0) ? (
                      <button
                        className="bulk-action-btn import-osm"
                        onClick={handleImportFromOSM}
                        disabled={!selectedCity || importingCities.has(`${selectedCity?.name}@${dataSource}`)}
                        title={
                          !selectedCity 
                            ? "Select a city first" 
                            : importingCities.has(`${selectedCity.name}@${dataSource}`)
                            ? `Import already in progress for this city in ${dataSource} data source`
                            : "Import all layers from OpenStreetMap"
                        }
                      >
                        <i className={`fas ${importingCities.has(`${selectedCity?.name}@${dataSource}`) ? 'fa-spinner fa-spin' : 'fa-download'}`}></i>
                        {importingCities.has(`${selectedCity?.name}@${dataSource}`) ? 'Importing...' : 'Import from OSM'}
                      </button>
                    ) : null}
                    {totalLayers > 0 && (
                      <>
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
                      </>
                    )}
                  </div>
                </div>
                <div className="layers-scroll-wrapper">
                  <div className="layers-scroll-content">
                    {Object.keys(filteredAndSortedDomains).length === 0 ? (
                      totalLayers === 0 ? (
                        <div className="no-results-message">
                          <i className="fas fa-layer-group"></i>
                          <h3>No Layers Yet</h3>
                          <p>Click "Add Layer" or "Import from OSM" above to create your first data layer.</p>
                        </div>
                      ) : (
                        <div className="no-results-message">
                          <i className="fas fa-search"></i>
                          <h3>No Results</h3>
                          <p>No layers or domains match "{searchQuery}"</p>
                        </div>
                      )
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
                                    
                                    if (showDomainExportMenu === domain) {
                                      setShowDomainExportMenu(null);
                                      setDropdownPositions({});
                                    } else {
                                      // Calculate position relative to scrollable container
                                      const button = e.currentTarget;
                                      const buttonRect = button.getBoundingClientRect();
                                      const container = button.closest('.layers-scroll-wrapper') || button.closest('.layers-container');
                                      const containerRect = container.getBoundingClientRect();
                                      
                                      const spaceBelow = containerRect.bottom - buttonRect.bottom;
                                      const spaceAbove = buttonRect.top - containerRect.top;
                                      
                                      // If less than 180px below, show above
                                      const showAbove = spaceBelow < 180 && spaceAbove > spaceBelow;
                                      
                                      setDropdownPositions({
                                        ...dropdownPositions,
                                        [`domain-${domain}`]: showAbove ? 'above' : 'below'
                                      });
                                      setShowDomainExportMenu(domain);
                                    }
                                  }}
                                  title="Export all layers in domain"
                                  disabled={exportingDomain === domain}
                                >
                                  <i className={`fas ${exportingDomain === domain ? 'fa-spinner fa-spin' : 'fa-download'}`}></i>
                                </button>
                                  {showDomainExportMenu === domain && (
                                    <div 
                                      className={`export-dropdown-inline ${
                                        dropdownPositions[`domain-${domain}`] === 'below' ? 'dropdown-below' : ''
                                      }`}
                                    >
                                    <button
                                      className="export-option"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleExportDomain(domain, layers, 'parquet');
                                      }}
                                    >
                                      <i className="fas fa-database"></i>
                                      <span>Parquet</span>
                                    </button>
                                    <button
                                      className="export-option"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleExportDomain(domain, layers, 'csv');
                                      }}
                                    >
                                      <i className="fas fa-file-csv"></i>
                                      <span>CSV</span>
                                    </button>
                                    <button
                                      className="export-option"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleExportDomain(domain, layers, 'geojson');
                                      }}
                                    >
                                      <i className="fas fa-map-marked-alt"></i>
                                      <span>GeoJSON</span>
                                    </button>
                                    <button
                                      className="export-option"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleExportDomain(domain, layers, 'shapefile');
                                      }}
                                    >
                                      <i className="fas fa-layer-group"></i>
                                      <span>Shapefile</span>
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
                                      dropdownPositions={dropdownPositions}
                                      setDropdownPositions={setDropdownPositions}
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
        getAllFeatures={getAllFeatures}
        selectedCity={selectedCity}
      />
    </motion.div>
  );
};

export default LayerSidebar;
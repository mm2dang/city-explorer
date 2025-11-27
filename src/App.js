import React, { useState, useEffect } from 'react';
import './styles/App.css';
import Header from './components/Header';
import LayerSidebar from './components/LayerSidebar';
import MapViewer from './components/MapViewer';
import AddCityWizard from './components/AddCityWizard';
import LayerModal from './components/LayerModal';
import IndicatorsSidebar from './components/IndicatorsSidebar';
import CalculateIndicatorsModal from './components/CalculateIndicatorsModal';
import LoadingScreen from './components/LoadingScreen';
import {
  getAllCitiesWithDataStatus,
  loadCityFeatures,
  saveCityData,
  deleteCityData,
  cancelCityProcessing,
  getAvailableLayersForCity,
  saveCustomLayer,
  deleteLayer,
  loadLayerForEditing,
  setDataSource
} from './utils/s3';
import {
  triggerGlueJobWithParams
} from './utils/indicators';
import confetti from './assets/confetti';

function App() {
  const [cities, setCities] = useState([]);
  const [selectedCity, setSelectedCity] = useState(null);
  const [activeLayers, setActiveLayers] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [showAddCityWizard, setShowAddCityWizard] = useState(false);
  const [showLayerModal, setShowLayerModal] = useState(false);
  const [editingCity, setEditingCity] = useState(null);
  const [cityDataStatus, setCityDataStatus] = useState({});
  const [processingProgress, setProcessingProgress] = useState({});
  const [availableLayers, setAvailableLayers] = useState({});
  const [editingLayer, setEditingLayer] = useState(null);
  const [dataSource, setDataSourceState] = useState('city');
  const [mapView, setMapView] = useState('street');
  const [showCalculateIndicatorsModal, setShowCalculateIndicatorsModal] = useState(false);
  const [isCalculatingIndicators, setIsCalculatingIndicators] = useState(false);
  const [connectivityProgress, setConnectivityProgress] = useState(null);
  const [isCalculatingConnectivity, setIsCalculatingConnectivity] = useState(false);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [isDataSourceSwitching, setIsDataSourceSwitching] = useState(false);

  // Initialize sidebar states based on screen size
  const [isLayerSidebarCollapsed, setIsLayerSidebarCollapsed] = useState(() => {
    return window.innerWidth <= 1200;
  });
  
  const [isIndicatorsSidebarCollapsed, setIsIndicatorsSidebarCollapsed] = useState(() => {
    return window.innerWidth <= 1200;
  });

  // Domain colors for consistent styling
  const domainColors = {
    mobility: '#fdd900',
    governance: '#005670',
    health: '#ffdb9d',
    economy: '#00b2e2',
    environment: '#3aaa35',
    social: '#f49ac1',
    education: '#ff8000',
    housing: '#b3d7b1',
    culture: '#e33e7f',
  };

  // Initialize data source on mount
  useEffect(() => {
    setDataSource('city');
    setDataSourceState('city');
    console.log('Data source initialized to: city (uploaded data)');
  }, []);

  // Load cities on mount
  useEffect(() => {
    loadCities();
  }, []);

  // Debounced feature reloading when activeLayers changes
  useEffect(() => {
    let timeoutId;
    
    const reloadFeatures = async () => {
      if (selectedCity && Object.keys(activeLayers).length > 0) {
        setIsLoading(true);
        try {
          const cityFeatures = await loadCityFeatures(selectedCity.name, activeLayers);
          console.log(`Loaded ${cityFeatures.length} features for active layers`);
        } catch (error) {
          console.error('Error loading features:', error);
        } finally {
          setIsLoading(false);
        }
      }
    };
    
    timeoutId = setTimeout(reloadFeatures, 300);
    
    return () => clearTimeout(timeoutId);
  }, [activeLayers, selectedCity]);

  useEffect(() => {
    // Make cities available globally
    window.citiesData = cities;
  }, [cities]);

  // Track window size
  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Auto-collapse both sidebars when screen becomes small
  useEffect(() => {
    const handleResize = () => {
      const isSmallScreen = window.innerWidth <= 1200;
      
      // If transitioning to small screen and both sidebars are open, close both
      if (isSmallScreen && !isLayerSidebarCollapsed && !isIndicatorsSidebarCollapsed) {
        console.log('Screen became small with both sidebars open - closing both');
        setIsLayerSidebarCollapsed(true);
        setIsIndicatorsSidebarCollapsed(true);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isLayerSidebarCollapsed, isIndicatorsSidebarCollapsed]);

  // Handle sidebar toggle with mutual exclusion on small screens
  const handleSidebarToggle = (sidebar) => {
    const isSmallScreen = windowWidth <= 1200;
    
    if (sidebar === 'layer') {
      const newCollapsed = !isLayerSidebarCollapsed;
      setIsLayerSidebarCollapsed(newCollapsed);
      
      // On small screens, if expanding main sidebar, collapse indicators sidebar
      if (isSmallScreen && !newCollapsed && !isIndicatorsSidebarCollapsed) {
        setIsIndicatorsSidebarCollapsed(true);
      }
    } else if (sidebar === 'indicators') {
      const newCollapsed = !isIndicatorsSidebarCollapsed;
      setIsIndicatorsSidebarCollapsed(newCollapsed);
      
      // On small screens, if expanding indicators sidebar, collapse main sidebar
      if (isSmallScreen && !newCollapsed && !isLayerSidebarCollapsed) {
        setIsLayerSidebarCollapsed(true);
      }
    }
  };

  const loadCities = async () => {
    setIsLoading(true);
    try {
      console.log('Loading cities from S3...');
      const citiesWithStatus = await getAllCitiesWithDataStatus();
      console.log(`Loaded ${citiesWithStatus.length} cities:`, citiesWithStatus);
      setCities(citiesWithStatus);

      const newStatus = {};
      citiesWithStatus.forEach(city => {
        newStatus[city.name] = city.hasDataLayers;
      });
      setCityDataStatus(newStatus);
    } catch (error) {
      console.error('Error loading cities:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCityStatusChange = (cityName, hasData) => {
    console.log(`Updating city status for ${cityName}: hasData=${hasData}`);
    setCityDataStatus(prev => ({
      ...prev,
      [cityName]: hasData
    }));
  };

  const handleDataSourceChange = async (newSource) => {
    console.log(`Switching data source from ${dataSource} to ${newSource}`);
    
    // Show loading screen
    setIsDataSourceSwitching(true);
    
    try {
      setDataSourceState(newSource);
      setDataSource(newSource);
      setSelectedCity(null);
      setActiveLayers({});
      setAvailableLayers({});
    
      console.log('Current processing progress:', processingProgress);
      console.log(`Showing processing for data source: ${newSource}`);
    
      const citiesWithStatus = await getAllCitiesWithDataStatus();
      setCities(citiesWithStatus);
    
      const newStatus = {};
      citiesWithStatus.forEach(city => {
        newStatus[city.name] = city.hasDataLayers;
      });
      setCityDataStatus(newStatus);
      console.log(`Loaded ${citiesWithStatus.length} cities from ${newSource} data source`);
    } catch (error) {
      console.error('Error loading cities after data source change:', error);
    } finally {
      // Hide loading screen after a brief delay to ensure UI is ready
      setTimeout(() => {
        setIsDataSourceSwitching(false);
      }, 500);
    }
  };

  const handleMapViewChange = (newView) => {
    console.log(`Changing map view to: ${newView}`);
    setMapView(newView);
  };

  const handleCitySelect = async (city) => {
    // Handle null case for deselecting city
    if (city === null) {
      console.log('City deselected');
      setSelectedCity(null);
      setActiveLayers({});
      setAvailableLayers({});
      return;
    }
  
    console.log('City selected:', city.name);
    setSelectedCity(city);
    setActiveLayers({});
  
    try {
      const layers = await getAvailableLayersForCity(city.name);
      console.log('Available layers for city:', layers);
      setAvailableLayers(layers);
  
      const allLayersActive = {};
      Object.keys(layers).forEach(layerName => {
        allLayersActive[layerName] = true;
      });
      setActiveLayers(allLayersActive);
    } catch (error) {
      console.error('Error loading available layers:', error);
      setAvailableLayers({});
    }
  };

  const handleLayerToggle = (layerName, isActive) => {
    console.log(`Layer ${layerName} toggled to ${isActive}`);
    
    setActiveLayers(prev => ({
      ...prev,
      [layerName]: isActive,
    }));
  };

  // Helper function to create processing key
  const getProcessingKey = (cityName, dataSource) => `${cityName}@${dataSource}`;

  const handleAddCity = async (cityData, startProcessing) => {
    const targetDataSource = dataSource;
    const processingKey = getProcessingKey(cityData.name, targetDataSource);
    
    try {
      console.log('Adding new city:', cityData, 'to data source:', targetDataSource);
      console.log('Processing key:', processingKey);
      const parts = cityData.name.split(',').map(p => p.trim());
      let city, province, country;

      if (parts.length === 2) {
        [city, country] = parts;
        province = '';
      } else {
        [city, province, country] = parts;
      }
      
      city = city.trim();
      province = province.trim();
      country = country.trim();
  
      // Explicitly set data source before saving
      setDataSource(targetDataSource);
      
      // Save city metadata to the CURRENT data source
      await saveCityData(cityData, country, province, city);
      await loadCities();
  
      if (startProcessing) {
        console.log('Starting background processing for:', cityData.name, 'in data source:', targetDataSource);
        console.log('Using processing key:', processingKey);
        
        // Deselect the city before starting processing
        if (selectedCity && selectedCity.name === cityData.name) {
          console.log('Deselecting city before processing:', cityData.name);
          setSelectedCity(null);
          setActiveLayers({});
          setAvailableLayers({});
        }
        
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
        
        setProcessingProgress(prev => ({
          ...prev,
          [processingKey]: {
            cityName: cityData.name,
            processed: 0,
            saved: 0,
            total: totalLayers, 
            status: 'processing',
            dataSource: targetDataSource
          }
        }));
  
        setCityDataStatus(prev => ({
          ...prev,
          [cityData.name]: false
        }));
  
        // Pass targetDataSource to the processing callback
        startProcessing((cityName, progress) => {
          const key = getProcessingKey(cityName, targetDataSource);
          console.log(`Processing progress for ${cityName} in ${targetDataSource} (key: ${key}):`, progress);
          
          setProcessingProgress(prev => ({
            ...prev,
            [key]: {
              cityName: cityName,
              processed: progress.processed !== undefined ? progress.processed : (prev[key]?.processed || 0),
              saved: progress.saved !== undefined ? progress.saved : (prev[key]?.saved || 0),
              total: progress.total || prev[key]?.total || totalLayers,
              status: progress.status || 'processing',
              dataSource: targetDataSource
            }
          }));
        
          if (progress.status === 'complete') {
            setProcessingProgress(prev => {
              const newProgress = { ...prev };
              delete newProgress[key];
              return newProgress;
            });
            
            loadCities();
          }
        }, targetDataSource);
      }
  
      setShowAddCityWizard(false);
      setEditingCity(null);
      confetti();
    } catch (error) {
      console.error('Error adding city:', error);
      alert(`Error adding city: ${error.message}`);
    }
  };

  const handleEditCity = (city) => {
    console.log('Editing city:', city.name);
    setEditingCity(city);
    setShowAddCityWizard(true);
  };

  const handleUpdateCity = async (updatedCityData, startProcessing, shouldRefresh) => {
    const targetDataSource = dataSource;
    const processingKey = getProcessingKey(updatedCityData.name, targetDataSource);
    
    try {
      console.log('Updating city:', updatedCityData, 'shouldRefresh:', shouldRefresh);
      console.log('Editing city (old name):', editingCity?.name);
      console.log('Target data source:', targetDataSource);
      console.log('Processing key:', processingKey);
      
      // Check if this city is currently selected and will be processed
      const isCurrentlySelected = selectedCity && 
        (selectedCity.name === updatedCityData.name || 
          (editingCity && selectedCity.name === editingCity.name));
      const willBeProcessed = startProcessing !== null;
  
      // If the selected city will be processed, deselect it first
      if (isCurrentlySelected && willBeProcessed) {
        console.log('Deselecting city before processing:', selectedCity.name);
        setSelectedCity(null);
        setActiveLayers({});
        setAvailableLayers({});
      }
      
      // Always reload cities after any update to get fresh data from S3
      console.log('Reloading all cities from S3 to get fresh metadata...');
      setIsLoading(true);
      
      try {
        const citiesWithStatus = await getAllCitiesWithDataStatus();
        console.log(`Reloaded ${citiesWithStatus.length} cities from S3:`, citiesWithStatus);
        
        setCities(citiesWithStatus);
  
        const newStatus = {};
        citiesWithStatus.forEach(city => {
          newStatus[city.name] = city.hasDataLayers;
        });
        setCityDataStatus(newStatus);
  
        // Only update selected city if it wasn't deselected for processing
        if (shouldRefresh && !willBeProcessed) {
          console.log('Looking for updated city in fresh data:', updatedCityData.name);
          
          const freshCity = citiesWithStatus.find(c => c.name === updatedCityData.name);
          if (freshCity) {
            console.log('Found fresh city data:', freshCity);
            
            // Update selected city if it's currently selected
            if (selectedCity && (selectedCity.name === updatedCityData.name || 
                                 (editingCity && selectedCity.name === editingCity.name))) {
              console.log('Updating selected city with fresh metadata');
              setSelectedCity(freshCity);
              
              // Force map to update by clearing and reloading available layers
              try {
                const layers = await getAvailableLayersForCity(freshCity.name);
                console.log('Reloaded available layers:', Object.keys(layers));
                setAvailableLayers(layers);
              } catch (error) {
                console.warn('Error reloading layers:', error);
              }
            }
          }
        }
      } catch (error) {
        console.error('Error reloading cities:', error);
        throw error;
      } finally {
        setIsLoading(false);
      }
  
      if (editingCity) {
        const isRename = editingCity.name !== updatedCityData.name;
        
        // Check if the old city is currently processing
        const oldProcessingKey = getProcessingKey(editingCity.name, targetDataSource);
        const oldCityProgress = processingProgress?.[oldProcessingKey];
        const isOldCityProcessing = oldCityProgress && oldCityProgress.status === 'processing';
        
        if (isRename) {
          console.log('City renamed, moving data and saving new metadata...');
          
          // If the old city is processing in data source and being renamed, cancel and delete processed layers
          if (isOldCityProcessing) {
            console.log(`Old city is processing in ${targetDataSource} - cancelling and deleting processed layers...`);
            
            // Cancel the processing for current data source only
            const wasCancelled = await cancelCityProcessing(editingCity.name);
            if (wasCancelled) {
              console.log('Cancelled active processing for old city name in', targetDataSource);
            }
            
            // Delete all processed layers for the old city
            console.log('Deleting all processed layers for old city name in', targetDataSource, '...');
            try {
              // Get list of available layers for the old city
              const oldLayers = await getAvailableLayersForCity(editingCity.name);
              
              // Delete each layer
              for (const layerName of Object.keys(oldLayers)) {
                const layerInfo = oldLayers[layerName];
                if (layerInfo.domain) {
                  console.log(`Deleting layer: ${layerName} (${layerInfo.domain}) from ${targetDataSource}`);
                  await handleDeleteLayer(layerInfo.domain, layerName, { silent: true });
                }
              }
              console.log('Successfully deleted all processed layers for old city name in', targetDataSource);
            } catch (layerError) {
              console.error('Error deleting processed layers:', layerError);
            }
            
            // Clear the processing progress for the old city name
            setProcessingProgress(prev => {
              const newProgress = { ...prev };
              delete newProgress[oldProcessingKey];
              return newProgress;
            });
          }
        } else {
          // if city is processing, we need to handle it
          if (isOldCityProcessing) {
            console.log(`City is being edited while processing in ${targetDataSource} - will cancel and clear processed layers`);
            
            // Cancel the current processing
            const wasCancelled = await cancelCityProcessing(editingCity.name);
            if (wasCancelled) {
              console.log('Cancelled active processing for city being edited in', targetDataSource);
            }
            
            // Delete all processed layers
            console.log('Deleting all processed layers for city being edited in', targetDataSource, '...');
            try {
              const oldLayers = await getAvailableLayersForCity(editingCity.name);
              
              for (const layerName of Object.keys(oldLayers)) {
                const layerInfo = oldLayers[layerName];
                if (layerInfo.domain) {
                  console.log(`Deleting layer: ${layerName} (${layerInfo.domain}) from ${targetDataSource}`);
                  await handleDeleteLayer(layerInfo.domain, layerName, { silent: true });
                }
              }
              console.log('Successfully deleted all processed layers in', targetDataSource);
            } catch (layerError) {
              console.error('Error deleting processed layers:', layerError);
            }
            
            // Clear the processing progress for current data source only
            setProcessingProgress(prev => {
              const newProgress = { ...prev };
              delete newProgress[oldProcessingKey];
              return newProgress;
            });
          }
        }
      }
  
      if (startProcessing) {
        console.log('Starting background processing for updated city:', updatedCityData.name, 'in data source:', targetDataSource);
        console.log('Using processing key:', processingKey);
        
        // Calculate total layers upfront for editing too
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
        
        setProcessingProgress(prev => ({
          ...prev,
          [processingKey]: {
            cityName: updatedCityData.name,
            processed: 0,
            saved: 0,
            total: totalLayers,
            status: 'processing',
            dataSource: targetDataSource
          }
        }));
  
        startProcessing((cityName, progress) => {
          const key = getProcessingKey(cityName, targetDataSource);
          console.log(`Processing progress for ${cityName} in ${targetDataSource} (key: ${key}):`, progress);
          
          setProcessingProgress(prev => ({
            ...prev,
            [key]: {
              cityName: cityName,
              processed: progress.processed !== undefined ? progress.processed : (prev[key]?.processed || 0),
              saved: progress.saved !== undefined ? progress.saved : (prev[key]?.saved || 0),
              total: progress.total || prev[key]?.total || totalLayers,
              status: progress.status || 'processing',
              dataSource: targetDataSource
            }
          }));
        
          // Only update status when explicitly marked as complete
          if (progress.status === 'complete') {
            setProcessingProgress(prev => {
              const newProgress = { ...prev };
              delete newProgress[key];
              return newProgress;
            });
            
            // Reload cities to get accurate status
            loadCities();
          }
        }, targetDataSource);
      }
  
      setShowAddCityWizard(false);
      setEditingCity(null);
      
      console.log('City update completed successfully');
      confetti();
    } catch (error) {
      console.error('Error updating city:', error);
      alert(`Error updating city: ${error.message}`);
    }
  };

  const handleDeleteCity = async (cityName) => {
    // Only check processing
    const processingKey = getProcessingKey(cityName, dataSource);
    const progress = processingProgress[processingKey];
    const isProcessing = progress && progress.status === 'processing';
    
    if (isProcessing) {
      const confirmMessage = `${cityName} is currently being processed in ${dataSource === 'osm' ? 'OpenStreetMap' : 'Uploaded'} data source. Deleting will cancel processing and remove all data. Are you sure?`;
      if (!window.confirm(confirmMessage)) {
        return;
      }
    } else {
      if (!window.confirm(`Are you sure you want to delete ${cityName} from ${dataSource === 'osm' ? 'OpenStreetMap' : 'Uploaded'} data source? This will remove all data for this city.`)) {
        return;
      }
    }
  
    try {
      console.log('Deleting city from current data source:', cityName, dataSource);
      
      // Cancel processing only for current data source if active
      if (isProcessing) {
        console.log(`Cancelling processing for: ${processingKey}`);
        await cancelCityProcessing(cityName);
      }
  
      // Delete city data (this already respects the current DATA_SOURCE_PREFIX in s3.js)
      await deleteCityData(cityName);
  
      if (selectedCity?.name === cityName) {
        setSelectedCity(null);
        setActiveLayers({});
      }
  
      // Clear processing progress only for current data source
      setProcessingProgress(prev => {
        const newProgress = { ...prev };
        delete newProgress[processingKey];
        return newProgress;
      });
  
      await loadCities();
      console.log('City deleted successfully from', dataSource);
    } catch (error) {
      console.error('Error deleting city:', error);
      alert(`Error deleting city: ${error.message}`);
    }
  };

  const handleEditLayer = async (domain, layerName) => {
    if (!selectedCity) {
      console.error('No city selected');
      return;
    }
  
    if (!domain || !layerName) {
      console.error('Invalid edit parameters:', { domain, layerName });
      alert('Cannot edit layer: missing domain or layer name');
      return;
    }
  
    try {
      console.log(`Loading layer for editing: domain="${domain}", layerName="${layerName}"`);
  
      const features = await loadLayerForEditing(
        selectedCity.name,
        domain,
        layerName
      );
  
      const layerInfo = availableLayers[layerName];
      const icon = layerInfo?.icon || 'fas fa-map-marker-alt';
  
      setEditingLayer({
        name: layerName,
        domain: domain,
        icon: icon,
        features: features
      });
      
      setShowLayerModal(true);
      console.log('Layer loaded for editing successfully');
    } catch (error) {
      console.error('Error loading layer for editing:', error);
      alert(`Error loading layer: ${error.message}`);
    }
  };

  const handleSaveLayer = async (layerData) => {
    try {      
      console.log('Saving custom layer:', layerData);
      if (!selectedCity) {
        throw new Error('No city selected');
      }
  
      // If editing with changes, the old layer was already deleted in LayerSidebar
      // Just save the new layer
      await saveCustomLayer(selectedCity.name, layerData, selectedCity.boundary);
  
      // Refresh available layers
      const layers = await getAvailableLayersForCity(selectedCity.name);
      setAvailableLayers(layers);
  
      // Update city status
      setCityDataStatus(prev => ({
        ...prev,
        [selectedCity.name]: true
      }));
  
      await loadCities();
  
      setShowLayerModal(false);
      setEditingLayer(null);
      console.log('Layer saved successfully');
      confetti();
    } catch (error) {
      console.error('Error saving layer:', error);
      alert(`Error saving layer: ${error.message}`);
    }
  };

  const handleDeleteLayer = async (domain, layerName, options = {}) => {
    if (!selectedCity) {
      console.error('No city selected');
      alert('Please select a city first');
      return;
    }
    
    if (!domain || !layerName) {
      console.error('Invalid delete parameters:', { domain, layerName });
      alert('Cannot delete layer: missing domain or layer name');
      return;
    }
  
    const displayName = layerName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    
    if (!options.silent && !window.confirm(`Are you sure you want to delete the layer "${displayName}"?`)) {
      return;
    }
  
    try {
      console.log(`Deleting layer: domain="${domain}", layerName="${layerName}", city="${selectedCity.name}" (silent: ${options.silent})`);
      
      await deleteLayer(selectedCity.name, domain, layerName);
  
      // Update active layers - this will trigger feature reload which clears geometries
      if (activeLayers[layerName]) {
        const newActiveLayers = { ...activeLayers };
        delete newActiveLayers[layerName];
        setActiveLayers(newActiveLayers);
      }
  
      const layers = await getAvailableLayersForCity(selectedCity.name);
      setAvailableLayers(layers);
      
      // Check if this was the last layer
      if (Object.keys(layers).length === 0) {
        console.log('Last layer deleted - updating city status to pending');
        handleCityStatusChange(selectedCity.name, false);
        
        await loadCities();
      }
      
      console.log('Layer deleted successfully');
    } catch (error) {
      console.error('Error deleting layer:', error);
      alert(`Error deleting layer: ${error.message}`);
    }
  };

  const handleCalculateIndicators = async (calculationParams) => {
    // Validate FIRST before setting any state
    const shouldCalculateConnectivity = calculationParams.calculateConnectivity;
    const shouldCalculateMobilePing = calculationParams.calculateMobilePing;
    
    if (!shouldCalculateConnectivity && !shouldCalculateMobilePing) {
      alert('Please select at least one calculation type');
      return;
    }
    
    // NOW set loading state after validation passes
    setIsCalculatingIndicators(true);
    
    // Close modal AFTER setting loading state
    setShowCalculateIndicatorsModal(false);
    
    try {
      console.log('Starting indicator calculation with parameters:', calculationParams);
      
      const shouldCalculateConnectivity = calculationParams.calculateConnectivity;
      const shouldCalculateMobilePing = calculationParams.calculateMobilePing;
      
      // Validate at least one calculation type is selected
      if (!shouldCalculateConnectivity && !shouldCalculateMobilePing) {
        alert('Please select at least one calculation type');
        setIsCalculatingIndicators(false);
        return;
      }
      
      // If connectivity is enabled, set connectivity state immediately to show progress bar
      if (shouldCalculateConnectivity) {
        setIsCalculatingConnectivity(true);
        
        // Parse cities to get total count for progress
        const cityCount = calculationParams.cities.CITY.split(',').length;
        
        setConnectivityProgress({
          current: 0,
          total: cityCount,
          currentCity: 'Initializing...',
          currentProgress: { message: 'Starting connectivity calculations...' }
        });
      }
      
      // Start connectivity calculation if enabled
      let connectivityPromise = null;
      if (shouldCalculateConnectivity) {
        connectivityPromise = calculateConnectivityForCities(calculationParams, (progress) => {
          window.dispatchEvent(new CustomEvent('connectivity-progress', { detail: progress }));
        }).catch(error => {
          console.error('Connectivity calculation failed:', error);
          // Clear connectivity state on error
          setIsCalculatingConnectivity(false);
          setConnectivityProgress(null);
        });
      }
      
      // Start Glue job only if mobile ping is enabled
      if (shouldCalculateMobilePing) {
        // Build glueParameters from calculationParams
        const glueParameters = {
          CITY: calculationParams.cities.CITY,
          PROVINCE: calculationParams.cities.PROVINCE,
          COUNTRY: calculationParams.cities.COUNTRY,
          START_MONTH: calculationParams.dateRange.START_MONTH,
          END_MONTH: calculationParams.dateRange.END_MONTH,
          USE_OSM: calculationParams.dataSource === 'osm' ? 'true' : 'false',
          JOB_NAME: 'calculate_indicators'
        };
        
        const result = await triggerGlueJobWithParams(glueParameters);
        console.log('Glue job started:', result.JobRunId);
      } else {
        console.log('Mobile ping calculation skipped (checkbox not checked)');
      }
      
      // Build alert message based on what's running
      let alertMessage = '';
      if (shouldCalculateConnectivity && shouldCalculateMobilePing) {
        alertMessage = 'Indicator calculation started. This may take several minutes.\n\nMobile ping indicators will be processed by AWS Glue.\nConnectivity calculations will run in your browser - please keep this tab open.';
      } else if (shouldCalculateConnectivity) {
        alertMessage = 'Connectivity calculation started.\n\nPlease keep this browser tab open until calculations are complete.';
      } else if (shouldCalculateMobilePing) {
        alertMessage = 'Mobile ping indicator calculation started. This may take several minutes.\n\nResults will be processed by AWS Glue.';
      }
      
      alert(alertMessage);
      confetti();
  
      // Wait for connectivity if it's running
      if (connectivityPromise) {
        await connectivityPromise;
      }
  
    } catch (error) {
      console.error('Error starting calculation:', error);
      alert(`Error starting calculation: ${error.message}`);
      // Clear connectivity state on error
      setIsCalculatingConnectivity(false);
      setConnectivityProgress(null);
    } finally {
      setIsCalculatingIndicators(false);
    }
  };

  const normalizeCountryName = (country) => {
    return country.toLowerCase().trim().replace(/\s+/g, ' ');
  };

  const calculateConnectivityForCities = async (calculationParams, onConnectivityProgress) => {
    console.log('=== CONNECTIVITY CALCULATION STARTED ===');
    console.log('Parameters:', calculationParams);
    
    // Import connectivity function and save function
    const { calculateConnectivityMetrics, saveConnectivityResults, getCountryCode, fetchWorldBankCoverage } = await import('./utils/connectivity');
    
    // Extract data from new structure
    const cityNames = calculationParams.cities.CITY.split(',').map(c => c.trim());
    const provinces = calculationParams.cities.PROVINCE.split(',').map(p => p.trim());
    const countries = calculationParams.cities.COUNTRY.split(',').map(c => c.trim());
    const startMonth = calculationParams.dateRange.START_MONTH;
    const endMonth = calculationParams.dateRange.END_MONTH;
    
    console.log(`Cities to process: ${cityNames.length}`);
    console.log('City list:', cityNames);
    console.log('Date range:', startMonth, 'to', endMonth);
    
    const generateMonthRange = (startMonth, endMonth) => {
      const months = [];
      const [startYear, startMon] = startMonth.split('-').map(Number);
      const [endYear, endMon] = endMonth.split('-').map(Number);

      let currentYear = startYear;
      let currentMonth = startMon;

      while (currentYear < endYear || (currentYear === endYear && currentMonth <= endMon)) {
        const monthStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
        months.push(monthStr);

        currentMonth++;
        if (currentMonth > 12) {
          currentMonth = 1;
          currentYear++;
        }
      }
      return months;
    };
    
    const months = generateMonthRange(startMonth, endMonth);
    console.log(`Generated ${months.length} months:`, months);
    
    // Fetch coverage data by country
    const coverageByCountry = new Map();

    // Normalize ALL country names consistently
    const normalizedCountries = countries.map(c => normalizeCountryName(c));
    const uniqueCountries = [...new Set(normalizedCountries)];

    console.log(`\n--- Fetching World Bank coverage data for ${uniqueCountries.length} countries ---`);
    console.log('Normalized country names:', uniqueCountries);

    for (const normalizedCountry of uniqueCountries) {
      try {
        const countryCode = getCountryCode(normalizedCountry);
        console.log(`[Coverage] Fetching for ${normalizedCountry} (code: ${countryCode})`);
        
        if (countryCode) {
          const coverage = await fetchWorldBankCoverage(countryCode);
          coverageByCountry.set(normalizedCountry, coverage);
          console.log(`[Coverage] ${normalizedCountry}: ${coverage}% (stored with key: "${normalizedCountry}")`);
        } else {
          console.warn(`[Coverage] No country code mapping for: ${normalizedCountry}`);
          coverageByCountry.set(normalizedCountry, 0);
        }
        
        // Add small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (error) {
        console.error(`[Coverage] Error fetching coverage for ${normalizedCountry}:`, error);
        console.error(`[Coverage] Error details:`, error.message);
        coverageByCountry.set(normalizedCountry, 0);
      }
    }
    
    // Log the entire coverage map
    console.log('[Coverage] Final coverage map:');
    for (const [key, value] of coverageByCountry.entries()) {
      console.log(`  "${key}": ${value}%`);
    }
    
    const connectivityResults = [];
    const startTime = Date.now();
    
    for (let i = 0; i < cityNames.length; i++) {
      const cityStartTime = Date.now();
      const cityName = cityNames[i];
      const province = provinces[i] || '';
      const country = countries[i];
      
      const fullCityName = province 
        ? `${cityName}, ${province}, ${country}`
        : `${cityName}, ${country}`;
      
      console.log(`\n--- Processing City ${i + 1}/${cityNames.length}: ${fullCityName} ---`);
      console.log('Looking up city in cities array...');
      console.log('Total cities available:', cities.length);
        
      const cityObj = cities.find(c => 
        c.name.toLowerCase() === fullCityName.toLowerCase()
      );
      
      if (!cityObj) {
        console.error(`City not found: ${fullCityName}`);
        console.log('Available cities:', cities.map(c => c.name).join(', '));
        continue;
      }
      
      console.log(`City found:`, cityObj.name);
      
      if (!cityObj.boundary) {
        console.error(`No boundary available for ${fullCityName}`);
        console.log('City object:', cityObj);
        continue;
      }
      
      console.log(`Boundary available (${typeof cityObj.boundary === 'string' ? 'WKT' : 'GeoJSON'})`);
      
      try {
        console.log(`Starting connectivity metrics calculation...`);
        
        // Returns array of quarterly results
        const quarterlyMetrics = await calculateConnectivityMetrics(
          cityObj.boundary,
          months,
          (progress) => {
            if (onConnectivityProgress) {
              onConnectivityProgress({
                current: i + 1,
                total: cityNames.length,
                currentCity: fullCityName,
                currentProgress: progress
              });
            }
          }
        );
        
        // Get coverage from the country-level cache
        const normalizedCountryForLookup = normalizeCountryName(country);
        const coverage = coverageByCountry.get(normalizedCountryForLookup);

        console.log(`[Coverage] Looking up coverage for country: "${country}"`);
        console.log(`[Coverage] Normalized to: "${normalizedCountryForLookup}"`);
        console.log(`[Coverage] Found value: ${coverage}%`);

        if (coverage === undefined) {
          console.error(`[Coverage] WARNING: No coverage found for key "${normalizedCountryForLookup}"`);
          console.log('[Coverage] Available keys:', Array.from(coverageByCountry.keys()));
        }

        const finalCoverage = coverage !== undefined ? coverage : 0;
        
        const cityElapsed = ((Date.now() - cityStartTime) / 1000).toFixed(2);
        
        console.log(`Connectivity calculation completed in ${cityElapsed}s`);
        console.log(`Calculated ${quarterlyMetrics.length} quarterly results`);
        
        // Create one result per quarter
        for (const quarterData of quarterlyMetrics) {
          console.log(`  Quarter ${quarterData.quarter}: Speed ${quarterData.speed.toFixed(2)} kbps, Latency ${quarterData.latency.toFixed(2)} ms`);
          
          connectivityResults.push({
            city: cityName,
            province: province,
            country: country,
            quarter: quarterData.quarter,
            speed: quarterData.speed,
            latency: quarterData.latency,
            coverage: finalCoverage,
            dateRange: `${startMonth}_to_${endMonth}`
          });
        }
        
      } catch (error) {
        const cityElapsed = ((Date.now() - cityStartTime) / 1000).toFixed(2);
        console.error(`Error calculating connectivity for ${fullCityName} (after ${cityElapsed}s):`, error);
        console.error('Error stack:', error.stack);
      }
    }
    
    const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log(`\n=== CONNECTIVITY CALCULATION SUMMARY ===`);
    console.log(`Total time: ${totalElapsed}s`);
    console.log(`Total quarterly results: ${connectivityResults.length}`);
    console.log(`Cities processed: ${cityNames.length}`);
    
    if (connectivityResults.length > 0) {
      try {
        console.log(`\nSaving ${connectivityResults.length} connectivity results to S3...`);
        console.log('Data source:', dataSource);
        console.log('Sample results:', connectivityResults.slice(0, 3));
        
        await saveConnectivityResults(dataSource, connectivityResults);
        
        console.log(`Successfully saved connectivity results to S3`);
      } catch (saveError) {
        console.error('Failed to save connectivity results to S3:', saveError);
        console.error('Save error stack:', saveError.stack);
        throw saveError;
      }
    } else {
      console.warn('No connectivity results to save');
    }
    
    console.log(`=== CONNECTIVITY CALCULATION COMPLETE ===\n`);
    window.dispatchEvent(new CustomEvent('connectivity-complete'));
    
    return connectivityResults;
  };

  const cancelConnectivityCalculation = () => {
    console.log('Cancelling connectivity calculation...');
    
    window.connectivityCancelled = true;
    
    setIsCalculatingConnectivity(false);
    setConnectivityProgress(null);
    
    // Also clear the main calculating state if only connectivity was running
    setIsCalculatingIndicators(false);
    
    // Dispatch complete event so IndicatorsSidebar also clears its state
    window.dispatchEvent(new CustomEvent('connectivity-complete'));
    
    alert('Connectivity calculation cancelled');
  };

  return (
    <div className="App">
      {isLoading && cities.length === 0 && (
        <LoadingScreen message="Connecting to data source..." />
      )}
      {isDataSourceSwitching && (
        <LoadingScreen message="Switching data source..." />
      )}
      <Header
        cities={cities}
        selectedCity={selectedCity}
        onCitySelect={handleCitySelect}
        onAddCity={() => {
          console.log('Add City button clicked');
          setShowAddCityWizard(true);
        }}
        onEditCity={handleEditCity}
        onDeleteCity={handleDeleteCity}
        isLoading={isLoading}
        cityDataStatus={cityDataStatus}
        processingProgress={processingProgress}
        dataSource={dataSource}
        onDataSourceChange={handleDataSourceChange}
        mapView={mapView}
        onMapViewChange={handleMapViewChange}
      />
      <div className="main-content">
      <LayerSidebar
        selectedCity={selectedCity}
        cityBoundary={selectedCity?.boundary}
        activeLayers={activeLayers}
        onLayerToggle={handleLayerToggle}
        onEditLayer={handleEditLayer}
        availableLayers={availableLayers}
        domainColors={domainColors}
        onLayerSave={handleSaveLayer}
        onLayerDelete={handleDeleteLayer}
        mapView={mapView}
        cities={cities}
        cityDataStatus={cityDataStatus}
        processingProgress={processingProgress}
        onImportComplete={(cityName, progress) => {
          const effectiveDataSource = progress.dataSource || dataSource;
          const processingKey = getProcessingKey(cityName, effectiveDataSource);
          
          console.log('Import complete callback:', { 
            cityName, 
            progressDataSource: progress.dataSource, 
            currentDataSource: dataSource, 
            effectiveDataSource, 
            processingKey,
            progressData: progress 
          });
          
          if (progress.status === 'processing') {
            console.log('Starting OSM import processing for:', cityName, 'in', effectiveDataSource);
            console.log('Progress values:', progress.processed, '/', progress.total, 'saved:', progress.saved);
            
            // Set processing progress with ALL fields
            setProcessingProgress(prev => {
              const newProgress = {
                ...prev,
                [processingKey]: {
                  cityName: cityName,
                  processed: progress.processed || 0,
                  saved: progress.saved || 0,
                  total: progress.total || 41,
                  status: 'processing',
                  dataSource: effectiveDataSource
                }
              };
              console.log('Updated processingProgress state:', newProgress[processingKey]);
              return newProgress;
            });
            
            // Set city status to not ready
            setCityDataStatus(prev => ({
              ...prev,
              [cityName]: false
            }));
          } else if (progress.status === 'complete') {
            // Processing complete - remove from processing progress
            console.log('OSM import complete for:', cityName, 'in', progress.dataSource, `Saved ${progress.saved || 0} layers`);
            console.log('Removing processing key:', processingKey);
            
            // Remove from processing progress
            setProcessingProgress(prev => {
              const newProgress = { ...prev };
              delete newProgress[processingKey];
              return newProgress;
            });
            
            // Reload cities to get fresh status
            loadCities();
          } else if (progress.status === 'failed') {
            // Processing failed - remove from processing progress
            console.log('OSM import failed for:', cityName, 'in', progress.dataSource);
            console.log('Removing processing key:', processingKey);
            
            setProcessingProgress(prev => {
              const newProgress = { ...prev };
              delete newProgress[processingKey];
              return newProgress;
            });
          } else {
            // Progress update - keep processing status
            console.log('OSM import progress for:', cityName, 'in', progress.dataSource, progress);
            setProcessingProgress(prev => ({
              ...prev,
              [processingKey]: {
                cityName: cityName,
                processed: progress.processed !== undefined ? progress.processed : (prev[processingKey]?.processed || 0),
                saved: progress.saved !== undefined ? progress.saved : (prev[processingKey]?.saved || 0),
                total: prev[processingKey]?.total || progress.total || 41,
                status: 'processing',
                dataSource: prev[processingKey]?.dataSource || progress.dataSource || dataSource
              }
            }));
          }
        }}
        onCityStatusChange={handleCityStatusChange}
        dataSource={dataSource}
        onCitySelect={handleCitySelect}
        isSidebarCollapsed={isLayerSidebarCollapsed}
        onToggleCollapse={() => handleSidebarToggle('layer')}
      />
      <MapViewer
        selectedCity={selectedCity}
        activeLayers={activeLayers}
        domainColors={domainColors}
        loadCityFeatures={loadCityFeatures}
        availableLayers={availableLayers}
        mapView={mapView}
        cities={cities}
        onCitySelect={handleCitySelect}
        processingProgress={processingProgress}
        dataSource={dataSource}
      />
      <IndicatorsSidebar
        selectedCity={selectedCity}
        dataSource={dataSource}
        onCalculateIndicators={() => setShowCalculateIndicatorsModal(true)}
        cities={cities}
        connectivityProgress={connectivityProgress}
        isCalculatingConnectivity={isCalculatingConnectivity}
        onCancelConnectivity={cancelConnectivityCalculation}
        onConnectivityProgressUpdate={setConnectivityProgress}
        onConnectivityStateChange={setIsCalculatingConnectivity}
        isCollapsed={isIndicatorsSidebarCollapsed}
        onToggleCollapse={() => handleSidebarToggle('indicators')}
      />
    </div>

    {showAddCityWizard && (
      <div className="wizard-overlay">
        <AddCityWizard
          onCancel={() => {
            setShowAddCityWizard(false);
            setEditingCity(null);
          }}
          onComplete={editingCity ? handleUpdateCity : handleAddCity}
          editingCity={editingCity}
          dataSource={dataSource}
          processingProgress={processingProgress}
        />
      </div>
      )}

      {showLayerModal && selectedCity && (
        <LayerModal
          isOpen={showLayerModal}
          cityName={selectedCity.name}
          cityBoundary={selectedCity.boundary}
          onClose={() => {
            setShowLayerModal(false);
            setEditingLayer(null);
          }}
          onSave={handleSaveLayer}
          editingLayer={editingLayer}
          domain={editingLayer?.domain}
          domainColor={editingLayer?.domain ? domainColors[editingLayer.domain] : undefined}
          existingLayers={Object.keys(availableLayers).map(name => ({
            name,
            ...availableLayers[name]
          }))}
          domainColors={domainColors}
          availableLayersByDomain={availableLayers}
          mapView={mapView}
        />
      )}

      {showCalculateIndicatorsModal && (
        <div className="wizard-overlay">
          <CalculateIndicatorsModal
            cities={cities}
            selectedCity={selectedCity}
            dataSource={dataSource}
            onCancel={() => setShowCalculateIndicatorsModal(false)}
            onCalculate={handleCalculateIndicators}
            isLoading={isCalculatingIndicators || isCalculatingConnectivity}
            processingProgress={processingProgress}
          />
        </div>
      )}
    </div>
  );
}

export default App;
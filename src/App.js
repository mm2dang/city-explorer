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
  setDataSource,
  clearCacheForDataSource,
  invalidateCityCache,
  prefetchCityMetadata,
  getCityDataFresh,
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
  }, []);

  // Load cities on mount
  useEffect(() => {
    loadCities();
  }, []);

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
      const citiesWithStatus = await getAllCitiesWithDataStatus();
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
    setCityDataStatus(prev => ({
      ...prev,
      [cityName]: hasData
    }));
  };

  const handleDataSourceChange = async (newSource) => {    
    // Clear cache for the new data source
    clearCacheForDataSource(newSource);
    
    setIsDataSourceSwitching(true);
    
    try {
      setDataSourceState(newSource);
      setDataSource(newSource);
      setSelectedCity(null);
      setActiveLayers({});
      setAvailableLayers({});
    
      const citiesWithStatus = await getAllCitiesWithDataStatus();
      setCities(citiesWithStatus);
    
      const newStatus = {};
      citiesWithStatus.forEach(city => {
        newStatus[city.name] = city.hasDataLayers;
      });
      setCityDataStatus(newStatus);
      
      // Prefetch metadata for first 10 cities
      if (citiesWithStatus.length > 0) {
        const cityNames = citiesWithStatus.slice(0, 10).map(c => c.name);
        prefetchCityMetadata(cityNames).catch(err => 
          console.warn('Prefetch failed:', err)
        );
      }
    } catch (error) {
      console.error('Error loading cities after data source change:', error);
    } finally {
      setTimeout(() => {
        setIsDataSourceSwitching(false);
      }, 500);
    }
  };

  const handleMapViewChange = (newView) => {
    setMapView(newView);
  };

  const handleCitySelect = async (city) => {
    if (city === null) {
      setSelectedCity(null);
      setActiveLayers({});
      setAvailableLayers({});
      return;
    }
    setSelectedCity(city);
    
    // First clear layers
    setActiveLayers({});
    setAvailableLayers({});
  
    try {
      const layers = await getAvailableLayersForCity(city.name);
      setAvailableLayers(layers);
  
      // Enable all layers
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
        // Deselect the city before starting processing
        if (selectedCity && selectedCity.name === cityData.name) {
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
            
            setDataSource(targetDataSource);
    
            saveCityData(cityData, country, province, city);
            
            // Invalidate cache after save
            invalidateCityCache(cityData.name);
            
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
    setEditingCity(city);
    setShowAddCityWizard(true);
  };

  const handleUpdateCity = async (updatedCityData, startProcessing, shouldRefresh) => {
    const targetDataSource = dataSource;
    const processingKey = getProcessingKey(updatedCityData.name, targetDataSource);
    
    try {
      // Check if this city is currently selected and will be processed
      const isCurrentlySelected = selectedCity && 
        (selectedCity.name === updatedCityData.name || 
          (editingCity && selectedCity.name === editingCity.name));
      const willBeProcessed = startProcessing !== null;
  
      // If the selected city will be processed, deselect it first
      if (isCurrentlySelected && willBeProcessed) {
        setSelectedCity(null);
        setActiveLayers({});
        setAvailableLayers({});
      }
      
      // Always reload cities after any update to get fresh data from S3
      setIsLoading(true);
      
      try {
        // Parse the city name to get components
        const parts = updatedCityData.name.split(',').map(p => p.trim());
        let city, province, country;
        if (parts.length === 2) {
          [city, country] = parts;
          province = '';
        } else {
          [city, province, country] = parts;
        }
  
        const citiesWithStatus = await getAllCitiesWithDataStatus();        
        setCities(citiesWithStatus);
  
        const newStatus = {};
        citiesWithStatus.forEach(city => {
          newStatus[city.name] = city.hasDataLayers;
        });
        setCityDataStatus(newStatus);

        if (shouldRefresh && !willBeProcessed && isCurrentlySelected) {
          // Step 1: Clear everything to force unmount
          setSelectedCity(null);
          setActiveLayers({});
          setAvailableLayers({});
          
          // Step 2: Force-load fresh data directly from S3, bypassing cache
          try {
            const freshCityData = await getCityDataFresh(country, province, city);
            
            if (freshCityData) {
              // Step 3: Find this city in the loaded cities and update it
              const cityIndex = citiesWithStatus.findIndex(c => c.name === freshCityData.name);
              if (cityIndex >= 0) {
                citiesWithStatus[cityIndex] = {
                  ...citiesWithStatus[cityIndex],
                  ...freshCityData
                };
                setCities([...citiesWithStatus]); // Force re-render with fresh data
              }
              
              // Step 4: Wait for React to process the clear
              await new Promise(resolve => setTimeout(resolve, 100));
              
              // Step 5: Set the fresh city with new boundary
              setSelectedCity(freshCityData);
              
              // Step 6: Reload and activate all layers
              setTimeout(async () => {
                try {
                  const layers = await getAvailableLayersForCity(freshCityData.name);
                  setAvailableLayers(layers);
                  
                  // Re-enable all layers that were previously active
                  const allLayersActive = {};
                  Object.keys(layers).forEach(layerName => {
                    allLayersActive[layerName] = true;
                  });
                  setActiveLayers(allLayersActive);
                } catch (error) {
                  console.warn('Error reloading layers:', error);
                }
              }, 150);
            }
          } catch (freshLoadError) {
            console.error('Error loading fresh city data:', freshLoadError);
          }
        }
  
        // Invalidate cache for both old and new city names if renamed
        if (editingCity && editingCity.name !== updatedCityData.name) {
          invalidateCityCache(editingCity.name);
        }
        invalidateCityCache(updatedCityData.name);
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
          // If the old city is processing in data source and being renamed, cancel and delete processed layers
          if (isOldCityProcessing) {
            try {
              // Get list of available layers for the old city
              const oldLayers = await getAvailableLayersForCity(editingCity.name);
              
              // Delete each layer
              for (const layerName of Object.keys(oldLayers)) {
                const layerInfo = oldLayers[layerName];
                if (layerInfo.domain) {
                  await handleDeleteLayer(layerInfo.domain, layerName, { silent: true });
                }
              }
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
            // Delete all processed layers
            try {
              const oldLayers = await getAvailableLayersForCity(editingCity.name);
              
              for (const layerName of Object.keys(oldLayers)) {
                const layerInfo = oldLayers[layerName];
                if (layerInfo.domain) {
                  await handleDeleteLayer(layerInfo.domain, layerName, { silent: true });
                }
              }
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
      if (isProcessing) {
        await cancelCityProcessing(cityName);
      }
  
      await deleteCityData(cityName);
      
      // Invalidate cache after delete
      invalidateCityCache(cityName);
  
      if (selectedCity?.name === cityName) {
        setSelectedCity(null);
        setActiveLayers({});
      }
  
      setProcessingProgress(prev => {
        const newProgress = { ...prev };
        delete newProgress[processingKey];
        return newProgress;
      });
  
      await loadCities();
    } catch (error) {
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
    } catch (error) {
      console.error('Error loading layer for editing:', error);
      alert(`Error loading layer: ${error.message}`);
    }
  };

  const handleSaveLayer = async (layerData) => {
    try {
      if (!selectedCity) {
        throw new Error('No city selected');
      }

      await saveCustomLayer(selectedCity.name, layerData, selectedCity.boundary);
      
      invalidateCityCache(selectedCity.name);
      setActiveLayers({});
      
      // Reload available layers
      const layers = await getAvailableLayersForCity(selectedCity.name);
      setAvailableLayers(layers);

      setCityDataStatus(prev => ({
        ...prev,
        [selectedCity.name]: true
      }));

      await loadCities();

      // Re-enable all layers after a short delay
      setTimeout(() => {
        const allLayersActive = {};
        Object.keys(layers).forEach(layerName => {
          allLayersActive[layerName] = true;
        });
        setActiveLayers(allLayersActive);
      }, 100);

      setShowLayerModal(false);
      setEditingLayer(null);
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
      await deleteLayer(selectedCity.name, domain, layerName); 
  
      if (activeLayers[layerName]) {
        const newActiveLayers = { ...activeLayers };
        delete newActiveLayers[layerName];
        setActiveLayers(newActiveLayers);
      }
  
      const layers = await getAvailableLayersForCity(selectedCity.name);
      setAvailableLayers(layers);
      
      if (Object.keys(layers).length === 0) {
        handleCityStatusChange(selectedCity.name, false);
        await loadCities();
      }
      
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
    
    // Set loading state after validation passes
    setIsCalculatingIndicators(true);
    
    // Close modal after setting loading state
    setShowCalculateIndicatorsModal(false);
    
    try {
      
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
        await triggerGlueJobWithParams(glueParameters);
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
    // Import connectivity function and save function
    const { calculateConnectivityMetrics, saveConnectivityResults, getCountryCode, fetchWorldBankCoverage } = await import('./utils/connectivity');
    
    // Extract data from new structure
    const cityNames = calculationParams.cities.CITY.split(',').map(c => c.trim());
    const provinces = calculationParams.cities.PROVINCE.split(',').map(p => p.trim());
    const countries = calculationParams.cities.COUNTRY.split(',').map(c => c.trim());
    const startMonth = calculationParams.dateRange.START_MONTH;
    const endMonth = calculationParams.dateRange.END_MONTH;

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
    
    // Fetch coverage data by country
    const coverageByCountry = new Map();

    // Normalize country names consistently
    const normalizedCountries = countries.map(c => normalizeCountryName(c));
    const uniqueCountries = [...new Set(normalizedCountries)];

    for (const normalizedCountry of uniqueCountries) {
      try {
        const countryCode = getCountryCode(normalizedCountry);
        
        if (countryCode) {
          const coverage = await fetchWorldBankCoverage(countryCode);
          coverageByCountry.set(normalizedCountry, coverage);
        } else {
          console.warn(`[Coverage] No country code mapping for: ${normalizedCountry}`);
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
    const connectivityResults = [];
    for (let i = 0; i < cityNames.length; i++) {
      const cityStartTime = Date.now();
      const cityName = cityNames[i];
      const province = provinces[i] || '';
      const country = countries[i];
      
      const fullCityName = province 
        ? `${cityName}, ${province}, ${country}`
        : `${cityName}, ${country}`;
        
      const cityObj = cities.find(c => 
        c.name.toLowerCase() === fullCityName.toLowerCase()
      );
      
      if (!cityObj) {
        console.error(`City not found: ${fullCityName}`);
        continue;
      }
      
      if (!cityObj.boundary) {
        console.error(`No boundary available for ${fullCityName}`);
        continue;
      }
      
      try {
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

        if (coverage === undefined) {
          console.error(`[Coverage] WARNING: No coverage found for key "${normalizedCountryForLookup}"`);
        }

        const finalCoverage = coverage !== undefined ? coverage : 0;
        
        // Create one result per quarter
        for (const quarterData of quarterlyMetrics) {
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
    
    if (connectivityResults.length > 0) {
      try {        
        await saveConnectivityResults(dataSource, connectivityResults);
      } catch (saveError) {
        console.error('Failed to save connectivity results to S3:', saveError);
        console.error('Save error stack:', saveError.stack);
        throw saveError;
      }
    } else {
      console.warn('No connectivity results to save');
    }
    window.dispatchEvent(new CustomEvent('connectivity-complete'));
    
    return connectivityResults;
  };

  const cancelConnectivityCalculation = () => {
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
          
          if (progress.status === 'processing') {
            // Set processing progress with all fields
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
              return newProgress;
            });
            
            // Set city status to not ready
            setCityDataStatus(prev => ({
              ...prev,
              [cityName]: false
            }));
          } else if (progress.status === 'complete') {
            // Remove from processing progress
            setProcessingProgress(prev => {
              const newProgress = { ...prev };
              delete newProgress[processingKey];
              return newProgress;
            });
            
            // Reload cities to get fresh status
            loadCities();
          } else if (progress.status === 'failed') {
            
            setProcessingProgress(prev => {
              const newProgress = { ...prev };
              delete newProgress[processingKey];
              return newProgress;
            });
          } else {
            // Progress update - keep processing status
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
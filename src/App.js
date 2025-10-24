import React, { useState, useEffect } from 'react';
import './styles/App.css';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import MapViewer from './components/MapViewer';
import AddCityWizard from './components/AddCityWizard';
import LayerModal from './components/LayerModal';
import IndicatorsSidebar from './components/IndicatorsSidebar';
import CalculateIndicatorsModal from './components/CalculateIndicatorsModal';
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
  const [isLoading, setIsLoading] = useState(false);
  const [showAddCityWizard, setShowAddCityWizard] = useState(false);
  const [showLayerModal, setShowLayerModal] = useState(false);
  const [editingCity, setEditingCity] = useState(null);
  const [cityDataStatus, setCityDataStatus] = useState({});
  const [processingProgress, setProcessingProgress] = useState({});
  const [availableLayers, setAvailableLayers] = useState({});
  const [editingLayer, setEditingLayer] = useState(null);
  const [dataSource, setDataSourceState] = useState('city');
  const [mapView, setMapView] = useState('street');
  // eslint-disable-next-line no-unused-vars
  const [features, setFeatures] = useState([]);
  const [showCalculateIndicatorsModal, setShowCalculateIndicatorsModal] = useState(false);
  const [isCalculatingIndicators, setIsCalculatingIndicators] = useState(false);

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
          setFeatures(cityFeatures);
        } catch (error) {
          console.error('Error loading features:', error);
          setFeatures([]);
        } finally {
          setIsLoading(false);
        }
      } else if (selectedCity && Object.keys(activeLayers).length === 0) {
        setFeatures([]);
      }
    };
    
    timeoutId = setTimeout(reloadFeatures, 300);
    
    return () => clearTimeout(timeoutId);
  }, [activeLayers, selectedCity]);

  useEffect(() => {
    // Make cities available globally
    window.citiesData = cities;
  }, [cities]);

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

  const handleDataSourceChange = async (newSource) => {
    console.log(`Switching data source from ${dataSource} to ${newSource}`);
    setDataSourceState(newSource);
    setDataSource(newSource);
    setSelectedCity(null);
    setActiveLayers({});
    setFeatures([]);
    setAvailableLayers({});

    setIsLoading(true);
    try {
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
      setIsLoading(false);
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
      setFeatures([]);
      setAvailableLayers({});
      return;
    }
  
    console.log('City selected:', city.name);
    setSelectedCity(city);
    setActiveLayers({});
    setFeatures([]);
  
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

  const handleAddCity = async (cityData, startProcessing) => {
    try {
      console.log('Adding new city:', cityData);
      const parts = cityData.name.split(',').map(p => p.trim());
      let city, province, country;
      
      if (parts.length === 2) {
        [city, country] = parts;
        province = '';
      } else {
        [city, province, country] = parts;
      }

      await saveCityData(cityData, country, province, city);
      await loadCities();

      if (startProcessing) {
        console.log('Starting background processing for:', cityData.name);
        setProcessingProgress(prev => ({
          ...prev,
          [cityData.name]: {
            processed: 0,
            saved: 0,
            total: 0,
            status: 'processing'
          }
        }));

        setCityDataStatus(prev => ({
          ...prev,
          [cityData.name]: false
        }));

        startProcessing((cityName, progress) => {
          console.log(`Processing progress for ${cityName}:`, progress);
          setProcessingProgress(prev => ({
            ...prev,
            [cityName]: progress
          }));

          if (progress.status === 'complete' && progress.saved > 0) {
            setCityDataStatus(prev => ({
              ...prev,
              [cityName]: true
            }));
          }
        });
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
    try {
      console.log('Updating city:', updatedCityData, 'shouldRefresh:', shouldRefresh);
      console.log('Editing city (old name):', editingCity?.name);
      
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
  
        // If metadata was updated and this is the selected city, update it with fresh data
        if (shouldRefresh) {
          console.log('Looking for updated city in fresh data:', updatedCityData.name);
          
          // Find the city by its NEW name (after rename)
          const freshCity = citiesWithStatus.find(c => c.name === updatedCityData.name);
          if (freshCity) {
            console.log('Found fresh city data:', freshCity);
            console.log('Fresh boundary length:', freshCity.boundary?.length);
            console.log('Fresh population:', freshCity.population);
            console.log('Fresh coordinates:', { lat: freshCity.latitude, lon: freshCity.longitude });
            
            // Update selected city if it's currently selected (check both old and new names)
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
          } else {
            console.warn('Could not find updated city in fresh data:', updatedCityData.name);
            console.log('Available cities:', citiesWithStatus.map(c => c.name));
            
            // If the city was renamed, try to find it by checking if the old name is gone
            if (editingCity && editingCity.name !== updatedCityData.name) {
              console.log('City was renamed, old name no longer exists as expected');
            }
          }
        }
      } catch (error) {
        console.error('Error reloading cities:', error);
        throw error;
      } finally {
        setIsLoading(false);
      }
  
      if (startProcessing) {
        console.log('Starting background processing for updated city:', updatedCityData.name);
        setProcessingProgress(prev => ({
          ...prev,
          [updatedCityData.name]: {
            processed: 0,
            saved: 0,
            total: 0,
            status: 'processing'
          }
        }));
  
        startProcessing((cityName, progress) => {
          console.log(`Processing progress for ${cityName}:`, progress);
          setProcessingProgress(prev => ({
            ...prev,
            [cityName]: progress
          }));
  
          if (progress.status === 'complete' && progress.saved > 0) {
            setCityDataStatus(prev => ({
              ...prev,
              [cityName]: true
            }));
          }
        });
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
    if (!window.confirm(`Are you sure you want to delete ${cityName}? This will remove all data for this city.`)) {
      return;
    }

    try {
      console.log('Deleting city:', cityName);
      const wasCancelled = await cancelCityProcessing(cityName);
      if (wasCancelled) {
        console.log('Cancelled active processing for city');
      }

      await deleteCityData(cityName);

      if (selectedCity?.name === cityName) {
        setSelectedCity(null);
        setActiveLayers({});
        setFeatures([]);
      }

      setProcessingProgress(prev => {
        const newProgress = { ...prev };
        delete newProgress[cityName];
        return newProgress;
      });

      await loadCities();
      console.log('City deleted successfully');
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

      await saveCustomLayer(selectedCity.name, layerData, selectedCity.boundary);

      const layers = await getAvailableLayersForCity(selectedCity.name);
      setAvailableLayers(layers);

      setCityDataStatus(prev => ({
        ...prev,
        [selectedCity.name]: true
      }));

      if (activeLayers[layerData.name]) {
        const cityFeatures = await loadCityFeatures(selectedCity.name, activeLayers);
        setFeatures(cityFeatures);
      }

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
  
      if (activeLayers[layerName]) {
        const newActiveLayers = { ...activeLayers };
        delete newActiveLayers[layerName];
        setActiveLayers(newActiveLayers);
      }
  
      const layers = await getAvailableLayersForCity(selectedCity.name);
      setAvailableLayers(layers);
      
      console.log('Layer deleted successfully');
    } catch (error) {
      console.error('Error deleting layer:', error);
      alert(`Error deleting layer: ${error.message}`);
    }
  };

  const handleCalculateIndicators = async (parameters) => {
    try {
      setIsCalculatingIndicators(true);
      console.log('Starting indicator calculation with parameters:', parameters);
      
      const shouldCalculateConnectivity = parameters.CALCULATE_CONNECTIVITY === 'true';
      
      let connectivityPromise = null;
      if (shouldCalculateConnectivity) {
        connectivityPromise = calculateConnectivityForCities(parameters, (progress) => {
          window.dispatchEvent(new CustomEvent('connectivity-progress', { detail: progress }));
        }).catch(error => {
          console.error('Connectivity calculation failed:', error);
        });
      }
      
      const result = await triggerGlueJobWithParams(parameters);
      console.log('Glue job started:', result.JobRunId);
      
      setShowCalculateIndicatorsModal(false);
      
      // Conditional alert message based on connectivity calculation
      const alertMessage = shouldCalculateConnectivity
        ? 'Indicator calculation started. This may take several minutes.\n\nPlease keep this browser tab open until connectivity calculations are complete.'
        : 'Indicator calculation started. This may take several minutes.';
      
      alert(alertMessage);
      confetti();
  
      if (connectivityPromise) {
        await connectivityPromise;
      }
  
    } catch (error) {
      console.error('Error starting calculation:', error);
      alert(`Error starting calculation: ${error.message}`);
    } finally {
      setIsCalculatingIndicators(false);
    }
  };
  
  const calculateConnectivityForCities = async (glueParameters, onConnectivityProgress) => {
    console.log('=== CONNECTIVITY CALCULATION STARTED ===');
    console.log('Parameters:', glueParameters);
    
    // Import connectivity function and save function
    const { calculateConnectivityMetrics, saveConnectivityResults } = await import('./utils/connectivity');
    
    const cityNames = glueParameters.CITY.split(',').map(c => c.trim());
    const provinces = glueParameters.PROVINCE.split(',').map(p => p.trim());
    const countries = glueParameters.COUNTRY.split(',').map(c => c.trim());
    const startMonth = glueParameters.START_MONTH;
    const endMonth = glueParameters.END_MONTH;
    
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
    
    // Fetch coverage data by country (cache to avoid duplicate API calls)
    const coverageByCountry = new Map();
    const uniqueCountries = [...new Set(countries)];
    
    console.log(`\n--- Fetching World Bank coverage data for ${uniqueCountries.length} countries ---`);
    
    for (const country of uniqueCountries) {
      try {
        // Dynamically import the coverage function
        const connectivityModule = await import('./utils/connectivity');
        const getCountryCode = connectivityModule.getCountryCode || ((name) => {
          // Inline fallback if not exported
          const map = {
            'canada': 'CAN',
            'united states': 'USA',
            'mexico': 'MEX',
            'brazil': 'BRA',
            'united kingdom': 'GBR',
            'france': 'FRA',
            'germany': 'DEU',
            'spain': 'ESP',
            'italy': 'ITA',
            'china': 'CHN',
            'india': 'IND',
            'japan': 'JPN',
            'australia': 'AUS'
          };
          return map[name.toLowerCase().trim()] || null;
        });
        
        const fetchWorldBankCoverage = connectivityModule.fetchWorldBankCoverage || (async (code) => {
          const url = `https://api.worldbank.org/v2/country/${code}/indicator/IT.CEL.SETS.P2?format=json&per_page=10&mrnev=1`;
          const response = await fetch(url);
          if (!response.ok) return 0;
          const data = await response.json();
          if (!data || !Array.isArray(data) || data.length < 2 || !Array.isArray(data[1]) || data[1].length === 0) return 0;
          const records = data[1];
          for (const record of records) {
            if (record.value !== null && !isNaN(record.value)) {
              return parseFloat(record.value);
            }
          }
          return 0;
        });
        
        const countryCode = getCountryCode(country);
        if (countryCode) {
          const coverage = await fetchWorldBankCoverage(countryCode);
          coverageByCountry.set(country.toLowerCase().trim(), coverage);
          console.log(`[Coverage] ${country}: ${coverage}%`);
        } else {
          console.warn(`[Coverage] No country code mapping for: ${country}`);
          coverageByCountry.set(country.toLowerCase().trim(), 0);
        }
      } catch (error) {
        console.error(`[Coverage] Error fetching coverage for ${country}:`, error);
        coverageByCountry.set(country.toLowerCase().trim(), 0);
      }
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
        
        const connectivity = await calculateConnectivityMetrics(
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
        const coverage = coverageByCountry.get(country.toLowerCase().trim()) || 0;
        
        const cityElapsed = ((Date.now() - cityStartTime) / 1000).toFixed(2);
        
        console.log(`Connectivity calculation completed in ${cityElapsed}s`);
        console.log(`  Speed: ${connectivity.speed.toFixed(2)} kbps`);
        console.log(`  Latency: ${connectivity.latency.toFixed(2)} ms`);
        console.log(`  Coverage: ${coverage.toFixed(2)}%`);
        
        connectivityResults.push({
          city: cityName,
          province: province,
          country: country,
          speed: connectivity.speed,
          latency: connectivity.latency,
          coverage: coverage,
          dateRange: `${startMonth}_to_${endMonth}`
        });
        
      } catch (error) {
        const cityElapsed = ((Date.now() - cityStartTime) / 1000).toFixed(2);
        console.error(`Error calculating connectivity for ${fullCityName} (after ${cityElapsed}s):`, error);
        console.error('Error stack:', error.stack);
      }
    }
    
    const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log(`\n=== CONNECTIVITY CALCULATION SUMMARY ===`);
    console.log(`Total time: ${totalElapsed}s`);
    console.log(`Successful: ${connectivityResults.length}/${cityNames.length} cities`);
    
    if (connectivityResults.length > 0) {
      try {
        console.log(`\nSaving ${connectivityResults.length} connectivity results to S3...`);
        console.log('Data source:', dataSource);
        console.log('Results:', connectivityResults);
        
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

  return (
    <div className="App">
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
        <Sidebar
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
        />
        <IndicatorsSidebar
          selectedCity={selectedCity}
          dataSource={dataSource}
          onCalculateIndicators={() => setShowCalculateIndicatorsModal(true)}
          cities={cities}
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
            isLoading={isCalculatingIndicators}
          />
        </div>
      )}
    </div>
  );
}

export default App;
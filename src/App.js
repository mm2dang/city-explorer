import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import MapViewer from './components/MapViewer';
import AddCityWizard from './components/AddCityWizard';
import { getAllCitiesWithDataStatus, getAvailableLayersForCity, loadCityFeatures, deleteCityData } from './utils/s3';
import confetti from 'canvas-confetti';
import '@fortawesome/fontawesome-free/css/all.min.css';
import './styles/App.css';

const domainColors = {
  mobility: '#FFD700',
  governance: '#1e3a8a', 
  health: '#fb923c',
  social: '#f9a8d4',
  environment: '#166534',
  economy: '#7dd3fc',
  education: '#ea580c',
  housing: '#84cc16',
  culture: '#d946ef'
};

const App = () => {
  const [cities, setCities] = useState([]);
  const [selectedCity, setSelectedCity] = useState(null);
  const [editingCity, setEditingCity] = useState(null);
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [activeLayers, setActiveLayers] = useState({});
  const [availableLayers, setAvailableLayers] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [cityDataStatus, setCityDataStatus] = useState({});
  const [processingProgress, setProcessingProgress] = useState({});
  const [error, setError] = useState(null);

  // Request notification permission on mount
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // Load cities from both population and data buckets with status
  const loadAllCities = useCallback(async () => {
    try {
      console.log('=== APP: Loading all cities with data status... ===');
      const allCitiesWithStatus = await getAllCitiesWithDataStatus();
      console.log('=== APP: Cities loaded ===', {
        count: allCitiesWithStatus.length,
        cities: allCitiesWithStatus.map(c => ({ name: c.name, hasData: c.hasDataLayers }))
      });
      
      // Create status mapping
      const statusMap = {};
      allCitiesWithStatus.forEach(city => {
        statusMap[city.name] = city.hasDataLayers;
      });
      
      return { cities: allCitiesWithStatus, statusMap };
    } catch (error) {
      console.error('=== APP: Error loading cities ===', error);
      setError(`Failed to load cities: ${error.message}`);
      return { cities: [], statusMap: {} };
    }
  }, []);

  // Initial load with better error handling
  useEffect(() => {
    const fetchCities = async () => {
      try {
        setIsLoading(true);
        setError(null);
        console.log('=== APP: Initial app load starting ===');
        
        const { cities: cityList, statusMap } = await loadAllCities();
        setCities(cityList);
        setCityDataStatus(statusMap);
        
        if (cityList.length === 0) {
          console.warn('=== APP: No cities found ===');
        } else {
          console.log(`=== APP: Successfully loaded ${cityList.length} cities ===`);
        }
      } catch (error) {
        console.error('=== APP: Fatal error during initial load ===', error);
        setError(`Failed to initialize app: ${error.message}`);
      } finally {
        setIsLoading(false);
      }
    };
    fetchCities();
  }, [loadAllCities]);
 
  useEffect(() => {
    if (!selectedCity?.name) return;

    const interval = setInterval(async () => {
      try {
        console.log('=== APP: Periodic refresh starting ===');
        
        // Refresh available layers for selected city
        const updatedLayers = await getAvailableLayersForCity(selectedCity.name);
        const layerCount = Object.keys(updatedLayers).length;
        
        setAvailableLayers(prev => {
          const currentLayerCount = Object.keys(prev).length;
          
          if (layerCount !== currentLayerCount) {
            console.log(`=== APP: Layer count changed for ${selectedCity.name}: ${currentLayerCount} → ${layerCount} ===`);
            return updatedLayers;
          }
          return prev;
        });
        
        // Refresh city status every 30 seconds
        if (Date.now() % 30000 < 10000) {
          const { statusMap } = await loadAllCities();
          setCityDataStatus(prev => {
            const hasChanges = Object.keys(statusMap).some(cityName => 
              prev[cityName] !== statusMap[cityName]
            );
            return hasChanges ? statusMap : prev;
          });
        }
        
      } catch (error) {
        console.warn('=== APP: Error in periodic refresh ===', error);
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [selectedCity?.name, loadAllCities]);

  const handleCitySelect = useCallback(async (city) => {
    try {
      console.log(`=== APP: City selection requested: ${city.name} ===`);
      
      setSelectedCity(city);
      setActiveLayers({});
      setAvailableLayers({});
      setError(null);
      
      console.log(`=== APP: Loading available layers for ${city.name} ===`);
      const availableLayers = await getAvailableLayersForCity(city.name);
      const layerCount = Object.keys(availableLayers).length;
      
      console.log(`=== APP: Available layers loaded ===`, {
        city: city.name,
        layerCount: layerCount,
        layers: availableLayers
      });
      
      setAvailableLayers(availableLayers);
      setActiveLayers({});
      
      if (layerCount === 0) {
        console.log(`=== APP: No layers found for ${city.name} - may still be processing ===`);
      }
      
    } catch (error) {
      console.error('=== APP: Error selecting city ===', error);
      setError(`Error loading city data: ${error.message}`);
    }
  }, []);

  const handleAddCity = useCallback(() => {
    setEditingCity(null);
    setIsWizardOpen(true);
  }, []);

  const handleEditCity = useCallback((city) => {
    setEditingCity(city);
    setIsWizardOpen(true);
  }, []);

  const handleDeleteCity = useCallback(async (cityName) => {
    if (window.confirm(`Are you sure you want to delete ${cityName}? This will delete all data for this city.`)) {
      try {
        console.log(`=== APP: Deleting city: ${cityName} ===`);
        await deleteCityData(cityName);
        
        const { cities: updatedCities, statusMap } = await loadAllCities();
        setCities(updatedCities);
        setCityDataStatus(statusMap);
        
        if (selectedCity?.name === cityName) {
          setSelectedCity(null);
          setActiveLayers({});
          setAvailableLayers({});
        }
        
        // Remove from processing progress
        setProcessingProgress(prev => {
          const updated = { ...prev };
          delete updated[cityName];
          return updated;
        });
        
        console.log(`=== APP: City ${cityName} deleted successfully ===`);
      } catch (error) {
        console.error('=== APP: Error deleting city ===', error);
        setError(`Failed to delete city: ${error.message}`);
      }
    }
  }, [selectedCity?.name, loadAllCities]);

  const handleLayerToggle = useCallback((layerName, enabled) => {
    console.log(`=== APP: Layer ${layerName} toggled: ${enabled} ===`);
    setActiveLayers(prev => ({
      ...prev,
      [layerName]: enabled
    }));
  }, []);

  const handleWizardComplete = useCallback(async (newCity, onProgressUpdate) => {
    console.log(`=== APP: Wizard completed for city: ${newCity.name} ===`);
    
    try {
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#00BFA5', '#0891b2']
      });
      
      setIsWizardOpen(false);
      setEditingCity(null);
      
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
      
      // Initialize progress tracking
      const progressHandler = (cityName, progress) => {
        console.log(`=== APP: Progress update for ${cityName}: ${progress.processed}/${progress.total} ===`);
        
        setProcessingProgress(prev => ({
          ...prev,
          [cityName]: progress
        }));
        
        if (progress.status === 'complete') {
          setCityDataStatus(prev => ({
            ...prev,
            [cityName]: true
          }));
          
          if ('Notification' in window && Notification.permission === 'granted') {
            const notification = new Notification('City Processing Complete!', {
              body: `${cityName} is ready to explore. ${progress.saved} layers with data.`,
              icon: '/logo192.png',
              tag: `complete-${cityName}`,
              requireInteraction: true
            });
            
            notification.onclick = () => {
              window.focus();
              notification.close();
            };
          }
          
          confetti({
            particleCount: 150,
            spread: 100,
            origin: { y: 0.6 },
            colors: ['#10b981', '#34d399']
          });
          
          setTimeout(() => {
            setProcessingProgress(prev => {
              const updated = { ...prev };
              delete updated[cityName];
              return updated;
            });
          }, 5000);
        }
      };
      
      // Call the callback passed from wizard with our progress handler
      if (onProgressUpdate) {
        onProgressUpdate(progressHandler);
      }
      
      // Initial progress state
      setProcessingProgress(prev => ({
        ...prev,
        [newCity.name]: { processed: 0, saved: 0, total: totalLayers, status: 'processing' }
      }));
      
      console.log('=== APP: Refreshing cities list after wizard completion ===');
      const { cities: updatedCities, statusMap } = await loadAllCities();
      setCities(updatedCities);
      setCityDataStatus(statusMap);
      
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('City Processing Started', {
          body: `Processing ${newCity.name}... Keep this tab open.`,
          icon: '/logo192.png',
          tag: `processing-${newCity.name}`
        });
      }
      
      setTimeout(() => {
        alert(`${newCity.name} added successfully!\n\n` +
              `• Processing ${totalLayers} layers\n` +
              `• Please keep this browser tab open until complete\n`);
      }, 1000);
      
    } catch (error) {
      console.error('=== APP: Error in wizard completion ===', error);
      setError(`City was added but there was an error refreshing the list: ${error.message}`);
    }
  }, [loadAllCities]);

  const clearError = () => {
    setError(null);
  };

  return (
    <div className="app">
      {error && (
        <div className="error-banner" style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          backgroundColor: '#fee2e2',
          color: '#dc2626',
          padding: '12px',
          textAlign: 'center',
          zIndex: 1000,
          borderBottom: '1px solid #fecaca'
        }}>
          <strong>Error:</strong> {error}
          <button 
            onClick={clearError}
            style={{
              marginLeft: '12px',
              background: 'none',
              border: 'none',
              color: '#dc2626',
              cursor: 'pointer',
              textDecoration: 'underline'
            }}
          >
            Dismiss
          </button>
        </div>
      )}
      
      <Header 
        cities={cities}
        selectedCity={selectedCity}
        onCitySelect={handleCitySelect}
        onAddCity={handleAddCity}
        onEditCity={handleEditCity}
        onDeleteCity={handleDeleteCity}
        isLoading={isLoading}
        cityDataStatus={cityDataStatus}
        processingProgress={processingProgress}
      />
      
      <div className="main-content" style={{ marginTop: error ? '60px' : '0' }}>
        {selectedCity && (
          <Sidebar 
            selectedCity={selectedCity}
            activeLayers={activeLayers}
            availableLayers={availableLayers}
            onLayerToggle={handleLayerToggle}
            domainColors={domainColors}
          />
        )}
        
        <MapViewer 
          selectedCity={selectedCity}
          activeLayers={activeLayers}
          domainColors={domainColors}
          loadCityFeatures={loadCityFeatures}
        />
      </div>

      <AnimatePresence>
        {isWizardOpen && (
          <motion.div
            className="wizard-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <AddCityWizard
              editingCity={editingCity}
              onComplete={handleWizardComplete}
              onCancel={() => {
                setIsWizardOpen(false);
                setEditingCity(null);
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default App;
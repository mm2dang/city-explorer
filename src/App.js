import React, { useState, useEffect } from 'react';
import './styles/App.css';
import Header from './components/Header';
import Sidebar from './components/Sidebar'; // Fixed import path
import MapViewer from './components/MapViewer';
import AddCityWizard from './components/AddCityWizard';
import LayerModal from './components/LayerModal';
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
  moveCityData,
  setDataSource
} from './utils/s3';

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

  // Domain colors for consistent styling
  const domainColors = {
    mobility: '#fdd900',     // Yellow
    governance: '#005670',   // Dark Teal Blue
    health: '#ffdb9d',       // Peach
    economy: '#00b2e2',      // Sky Blue
    environment: '#3aaa35',  // Green
    social: '#f49ac1',       // Pink
    education: '#ff8000',    // Orange
    housing: '#b3d7b1',      // Light Green
    culture: '#e33e7f',      // Deep Pink
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
        // No active layers, clear features
        setFeatures([]);
      }
    };
    
    // Debounce the feature reload by 300ms to batch multiple toggles
    timeoutId = setTimeout(reloadFeatures, 300);
    
    return () => clearTimeout(timeoutId);
  }, [activeLayers, selectedCity]);

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
    
    // Update state immediately without reloading
    // The useEffect hook will handle the debounced reload
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

  const handleUpdateCity = async (updatedCityData, startProcessing) => {
    try {
      console.log('Updating city:', updatedCityData);
      const oldParts = editingCity.name.split(',').map(p => p.trim());
      const newParts = updatedCityData.name.split(',').map(p => p.trim());
      
      let oldCity, oldProvince, oldCountry;
      let newCity, newProvince, newCountry;

      if (oldParts.length === 2) {
        [oldCity, oldCountry] = oldParts;
        oldProvince = '';
      } else {
        [oldCity, oldProvince, oldCountry] = oldParts;
      }

      if (newParts.length === 2) {
        [newCity, newCountry] = newParts;
        newProvince = '';
      } else {
        [newCity, newProvince, newCountry] = newParts;
      }

      const locationChanged =
        oldCountry !== newCountry ||
        oldProvince !== newProvince ||
        oldCity !== newCity;

      if (locationChanged) {
        console.log('Location changed, moving data...');
        await moveCityData(
          oldCountry, oldProvince, oldCity,
          newCountry, newProvince, newCity
        );
      }

      await saveCityData(updatedCityData, newCountry, newProvince, newCity);
      await loadCities();

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

      if (selectedCity?.name === editingCity.name) {
        setSelectedCity(null);
        setActiveLayers({});
        setFeatures([]);
      }

      setShowAddCityWizard(false);
      setEditingCity(null);
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
    } catch (error) {
      console.error('Error saving layer:', error);
      alert(`Error saving layer: ${error.message}`);
    }
  };

  const handleDeleteLayer = async (domain, layerName, options = {}) => {
    // Validate inputs
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
        />
        <MapViewer
          selectedCity={selectedCity}
          activeLayers={activeLayers}
          domainColors={domainColors}
          loadCityFeatures={loadCityFeatures}
          availableLayers={availableLayers}
          mapView={mapView}
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

      {showLayerModal && (
        <LayerModal
          cityName={selectedCity?.name}
          cityBoundary={selectedCity?.boundary}
          onClose={() => {
            setShowLayerModal(false);
            setEditingLayer(null);
          }}
          onSave={handleSaveLayer}
          editingLayer={editingLayer}
        />
      )}
    </div>
  );
}

export default App;
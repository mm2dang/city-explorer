# CityExplorer

A modern web application for exploring and analyzing urban data across multiple domains. CityExplorer allows you to add cities, process geographic features from OpenStreetMap, and visualize urban infrastructure layers on an interactive map.

## File Structure

```
cityexplorer/
├── public/
│   ├── index.html
│   ├── manifest.json
│   └── worker.js              # Web Worker for OSM data processing
├── src/
│   ├── components/
│   │   ├── Header.js          # City selector and status display
│   │   ├── Sidebar.js         # Domain and layer controls
│   │   ├── MapViewer.js       # Leaflet map with clustering
│   │   ├── AddCityWizard.js   # Multi-step city creation wizard
│   │   └── LayerToggle.js     # Individual layer toggle component
│   ├── utils/
│   │   ├── s3.js              # AWS S3 operations and data processing
│   │   ├── osm.js             # OpenStreetMap and Wikipedia API calls
│   │   ├── regions.js         # UN SDG region mapping
│   │   └── exportUtils.js     # Export layers to local computer
│   ├── styles/
│   │   ├── App.css
│   │   ├── Header.css
│   │   ├── Sidebar.css
│   │   └── MapViewer.css
│   ├── App.js                 # Main application component
│   └── index.js               # React entry point
├── package.json
├── .env                       # Environment variables
└── README.md
```

## Features

- **Interactive Map Visualization**: Explore city boundaries and feature layers using Leaflet
- **Add City Wizard**: Search for cities, define boundaries (upload GeoJSON or draw), and automatically fetch population data
- **Real-time Processing**: Background data processing with live progress updates
- **Multi-Domain Analysis**: View urban features across 9 domains (mobility, governance, health, economy, environment, culture, education, housing, social)
- **41 Layer Types**: From roads and parks to hospitals and schools
- **S3 Data Storage**: Efficient Parquet format with Snappy compression
- **Responsive Design**: Modern UI with smooth animations

## Domain Colors

- **Mobility**: Yellow (#FFD700) 
- **Governance**: Dark Blue (#1e3a8a)
- **Health**: Light Orange (#fb923c)
- **Social**: Light Pink (#f9a8d4)
- **Environment**: Dark Green (#166534)
- **Economy**: Light Blue (#7dd3fc)
- **Education**: Dark Orange (#ea580c)
- **Housing**: Light Green (#84cc16)
- **Culture**: Magenta (#d946ef)

## Setup

1. Clone the repository
```bash
git clone https://github.com/mm2dang/osm-processor
cd cityexplorer
```
2. Install dependencies
```bash
npm install
```
3. Create a .env file in the project root:
```
# AWS Configuration
REACT_APP_AWS_REGION=us-east-1
REACT_APP_AWS_ACCESS_KEY_ID=your_access_key
REACT_APP_AWS_SECRET_ACCESS_KEY=your_secret_key
REACT_APP_AWS_SESSION_TOKEN=your_session_token

# S3 Bucket Configuration
REACT_APP_S3_BUCKET_NAME=your-bucket-name

# API Configuration (optional, defaults provided)
REACT_APP_OVERPASS_API_URL=https://overpass-api.de/api/interpreter
REACT_APP_NOMINATIM_API_URL=https://nominatim.openstreetmap.org
REACT_APP_WIKIPEDIA_API_URL=https://en.wikipedia.org/w/api.php

# Application Configuration (optional)
REACT_APP_MAX_CITIES=100
REACT_APP_MAX_FEATURES_PER_DOMAIN=10000
```
4. Run the development server
```bash
npm start
```
5. Open http://localhost:3000 in your browser

## Development

1. Clone the repo
```bash
git clone https://github.com/mm2dang/osm-processor.git
cd osm-processor
```
2. Edit the code locally
3. Check changes
```bash
git status
```
4. Stage the changes
```bash
git add .
```
5. Commit changes
```bash
git commit -m "Describe update here"
```
6. Push to GitHub
```bash
git push origin main
```

## Usage

### Adding a City

1. Click "Add City" in the header
2. Step 1 - Search: Enter city name, province/state, and country. Search OpenStreetMap for results
3. Step 2 - Details: Review/edit population and area (auto-fetched from Wikipedia)
4. Step 3 - Boundary: Upload a GeoJSON file or draw the city boundary on the map
5. Click "Add City" to save

The app will:
- Save city metadata to S3
- Start processing 41 feature layers in the background
- Show real-time progress in the header dropdown

### Viewing City Data

1. Select a city from the header dropdown
2. The map will zoom to the city boundary
3. Use the sidebar to expand domains and toggle individual layers
4. Markers will cluster automatically and show feature details on click

## Data Storage

### S3 Bucket Structure

```
s3://your-bucket-name/
├── population/
│   └── country={country}/
│       └── province={province}/
│           └── city={city}/
│               └── city_data.snappy.parquet
│
└── data/
    └── country={country}/
        └── province={province}/
            └── city={city}/
                └── domain={domain}/
                    ├── roads.snappy.parquet
                    ├── parks.snappy.parquet
                    └── ... (other layers)
```

### Parquet Schema
#### City Data
**File name**: `city_data.snappy.parquet`
**Fields**: 
- `name`: string
- `longitude`: float
- `latitude`: float
- `boundary`: string (GeoJSON geometry)
- `population`: int (nullable)
- `size`: float (nullable, km²)
- `sdg_region`: string

#### Feature Data
**File name**: ex. `roads.snappy.parquet`
**Fields**:
- `feature_name`: string (nullable)
- `geometry_type`: string (Point, LineString, Polygon, Multi*)
- `longitude`: float (representative point)
- `latitude`: float (representative point)
- `geometry_coordinates`: string (complete GeoJSON geometry)
- `layer_name`: string
- `domain_name`: string

## Technologies Used

- **React 18**: UI framework
- **Leaflet**: Interactive maps with marker clustering
- **React Leaflet**: React bindings for Leaflet
- **Leaflet Draw**: Boundary drawing tools
- **Framer Motion**: Smooth animations
- **AWS SDK v3**: S3 operations
- **Parquet-WASM**: Client-side Parquet read/write
- **Apache Arrow**: Columnar data processing
- **Turf.js**: Geospatial analysis
- **OpenStreetMap APIs**: Nominatim (geocoding), Overpass (features)
- **Wikipedia API**: Population data enrichment
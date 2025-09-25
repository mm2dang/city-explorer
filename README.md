# CityExplorer

A modern city map analysis tool for exploring urban data across multiple domains.

## File Structure

```
cityexplorer/
├── public/
│   ├── index.html
│   ├── manifest.json
│   └── worker.js
├── src/
│   ├── components/
│   │   ├── Header.js
│   │   ├── Sidebar.js
│   │   ├── MapViewer.js
│   │   ├── AddCityWizard.js
│   │   └── LayerToggle.js
│   ├── utils/
│   │   ├── s3.js
│   │   ├── osm.js
│   │   └── regions.js
│   ├── styles/
│   │   ├── App.css
│   │   ├── Header.css
│   │   ├── Sidebar.css
│   │   ├── MapViewer.css
│   │   └── leaflet.css
│   ├── App.js
│   └── index.js
├── package.json
└── README.md
```

## Features

- Modern, clean UI with pastel color scheme
- Interactive world map with city selection
- Domain-based layer organization with color coding
- Add City Wizard with boundary drawing
- S3 data storage with Parquet format
- Background data processing
- Responsive design

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

1. Install dependencies: `npm install`
2. Set up environment variables for AWS S3
3. Run the development server: `npm start`

## Data Storage

### City Data
Path: `s3://veraset-data-qoli-dev/population/country={country}/province={province}/city={city}/`
Fields: longitude, latitude, boundary, population, size, sdg_region

### Feature Data
Path: `s3://veraset-data-qoli-dev/data/country={country}/province={province}/city={city}/domain={domain}/`
Fields: feature_name, longitude, latitude, layer_name, domain_name

## Technologies Used

- React
- Leaflet for mapping
- Framer Motion for animations
- AWS S3 for data storage
- OpenStreetMap for city search
- Parquet with ZSTD compression
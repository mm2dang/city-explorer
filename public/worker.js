importScripts('https://unpkg.com/@turf/turf@6.5.0/turf.min.js');

self.onmessage = async (e) => {
  try {
    const { cityName, boundary, tagsList } = e.data;

    // Define geometry type requirements
    const lineLayers = ['roads', 'sidewalks', 'subways', 'railways', 'waterways'];
    const polygonLayers = ['nature', 'lakes', 'parks', 'open_green_spaces'];

    // Convert boundary to Overpass bounding box format
    let bbox;
    if (!boundary || !boundary.coordinates) {
      throw new Error('Invalid boundary: No coordinates provided');
    }

    // Calculate bbox that encompasses all polygons in the boundary
    let allCoords = [];
    if (boundary.type === 'Polygon') {
      allCoords = boundary.coordinates[0];
    } else if (boundary.type === 'MultiPolygon') {
      // Collect all outer rings from all polygons
      for (const polygon of boundary.coordinates) {
        allCoords.push(...polygon[0]);
      }
    } else {
      throw new Error(`Unsupported boundary type: ${boundary.type}`);
    }
    
    if (allCoords.length === 0) {
      throw new Error('No coordinates found in boundary');
    }
    
    const lons = allCoords.map(([lon]) => lon);
    const lats = allCoords.map(([, lat]) => lat);
    const south = Math.min(...lats);
    const west = Math.min(...lons);
    const north = Math.max(...lats);
    const east = Math.max(...lons);
    bbox = `${south},${west},${north},${east}`;
    
    console.log(`Calculated bbox for ${boundary.type}:`, bbox);
    if (boundary.type === 'MultiPolygon') {
      console.log(`MultiPolygon contains ${boundary.coordinates.length} separate polygons`);
    }

    // Simplify boundary to reduce complexity
    let simplifiedBoundary = boundary;
    try {
      if (boundary.type === 'Polygon' || boundary.type === 'MultiPolygon') {
        const boundaryFeature = {
          type: 'Feature',
          geometry: boundary,
          properties: {}
        };
        const simplified = turf.simplify(boundaryFeature, { tolerance: 0.001, highQuality: true });
        simplifiedBoundary = simplified.geometry;
        console.log(`Simplified ${boundary.type} boundary for faster processing`);
      }
    } catch (error) {
      console.warn('Error simplifying boundary:', error);
      simplifiedBoundary = boundary;
    }
    
    // Create boundary feature for intersection tests
    const boundaryFeature = {
      type: 'Feature',
      geometry: simplifiedBoundary,
      properties: {}
    };

    const results = [];
    
    // Duplicate detection sets
    const seenPoints = new Set();
    const seenLineStrings = new Set();
    const seenGeometries = new Set();

    // Helper function to check for duplicate points
    const isDuplicatePoint = (coord) => {
      const key = `${coord[0].toFixed(6)},${coord[1].toFixed(6)}`;
      if (seenPoints.has(key)) {
        return true;
      }
      seenPoints.add(key);
      return false;
    };

    // Helper function to check for duplicate LineStrings
    const isDuplicateLineString = (coords) => {
      const coordString = coords.map(c => `${c[0].toFixed(6)},${c[1].toFixed(6)}`).join('|');
      if (seenLineStrings.has(coordString)) {
        return true;
      }
      seenLineStrings.add(coordString);
      return false;
    };

    // Helper function to check for duplicate MultiLineStrings
    const isDuplicateMultiLineString = (coordsArray) => {
      const coordString = coordsArray.map(line => 
        line.map(c => `${c[0].toFixed(6)},${c[1].toFixed(6)}`).join('|')
      ).join('||');
      if (seenLineStrings.has(coordString)) {
        return true;
      }
      seenLineStrings.add(coordString);
      return false;
    };

    // Helper function to check for duplicate geometries
    const isDuplicateGeometry = (geometry) => {
      const coordString = JSON.stringify(geometry.coordinates);
      const hash = coordString.length + '_' + coordString.substring(0, 100);
      if (seenGeometries.has(hash)) {
        return true;
      }
      seenGeometries.add(hash);
      return false;
    };
    
    // Helper function to validate coordinate array
    const isValidCoordinate = (coord) => {
      return Array.isArray(coord) && coord.length === 2 && 
             !isNaN(coord[0]) && !isNaN(coord[1]) &&
             isFinite(coord[0]) && isFinite(coord[1]);
    };

    // Helper function to validate and clean coordinate arrays
    const cleanCoordinates = (coords) => {
      return coords.filter(coord => isValidCoordinate(coord));
    };

    // Helper function to process way geometry into appropriate GeoJSON
    const processWayGeometry = (el, filename) => {
      if (!el.geometry || !Array.isArray(el.geometry)) return null;

      const coords = el.geometry
        .filter(g => g && g.lon !== undefined && g.lat !== undefined)
        .map(g => [parseFloat(g.lon), parseFloat(g.lat)]);

      const cleanedCoords = cleanCoordinates(coords);
      if (cleanedCoords.length < 2) return null;

      const isClosed = cleanedCoords.length >= 4 && 
        Math.abs(cleanedCoords[0][0] - cleanedCoords[cleanedCoords.length-1][0]) < 0.0001 && 
        Math.abs(cleanedCoords[0][1] - cleanedCoords[cleanedCoords.length-1][1]) < 0.0001;

      if (lineLayers.includes(filename)) {
        // Line layers: create LineString
        let lineCoords = [...cleanedCoords];
        if (isClosed && lineCoords.length > 3) {
          lineCoords.pop(); // Remove closing coordinate for LineString
        }
        if (lineCoords.length >= 2) {
          return { 
            type: 'LineString', 
            coordinates: lineCoords 
          };
        }
      } else if (polygonLayers.includes(filename)) {
        // Polygon layers: create Polygon
        let polyCoords = [...cleanedCoords];
        if (!isClosed && polyCoords.length >= 3) {
          polyCoords.push([...polyCoords[0]]); // Close the polygon
        }
        if (polyCoords.length >= 4) {
          return { 
            type: 'Polygon', 
            coordinates: [polyCoords] 
          };
        }
      } else {
        // Mixed layers: prefer appropriate geometry type
        if (isClosed && cleanedCoords.length >= 4) {
          return { 
            type: 'Polygon', 
            coordinates: [cleanedCoords] 
          };
        } else if (cleanedCoords.length >= 2) {
          let lineCoords = [...cleanedCoords];
          if (isClosed && lineCoords.length > 2) {
            lineCoords.pop(); // Remove closing coordinate
          }
          return { 
            type: 'LineString', 
            coordinates: lineCoords 
          };
        }
      }

      return null;
    };

    // Helper function to process relation geometry
    const processRelationGeometry = (el, filename) => {
      if (!el.geometry || !Array.isArray(el.geometry)) return null;

      // Group coordinates by member role or sequence
      const memberGroups = [];
      let currentGroup = [];

      for (const g of el.geometry) {
        if (!g || g.lon === undefined || g.lat === undefined) continue;
        
        const coord = [parseFloat(g.lon), parseFloat(g.lat)];
        if (!isValidCoordinate(coord)) continue;

        currentGroup.push(coord);
      }

      if (currentGroup.length > 0) {
        memberGroups.push(currentGroup);
      }

      if (memberGroups.length === 0) return null;

      // For relations, try to create appropriate multi-geometry
      if (polygonLayers.includes(filename)) {
        // Create MultiPolygon for polygon layers
        const polygons = [];
        
        for (const coords of memberGroups) {
          const cleanedCoords = cleanCoordinates(coords);
          if (cleanedCoords.length >= 3) {
            const isClosed = Math.abs(cleanedCoords[0][0] - cleanedCoords[cleanedCoords.length-1][0]) < 0.0001 && 
                           Math.abs(cleanedCoords[0][1] - cleanedCoords[cleanedCoords.length-1][1]) < 0.0001;
            
            let polyCoords = [...cleanedCoords];
            if (!isClosed) {
              polyCoords.push([...polyCoords[0]]); // Close the polygon
            }
            
            if (polyCoords.length >= 4) {
              polygons.push([polyCoords]);
            }
          }
        }

        if (polygons.length === 1) {
          return { 
            type: 'Polygon', 
            coordinates: polygons[0] 
          };
        } else if (polygons.length > 1) {
          return { 
            type: 'MultiPolygon', 
            coordinates: polygons 
          };
        }
      } else if (lineLayers.includes(filename)) {
        // Create MultiLineString for line layers
        const lineStrings = [];
        
        for (const coords of memberGroups) {
          const cleanedCoords = cleanCoordinates(coords);
          if (cleanedCoords.length >= 2) {
            // Ensure LineString is not closed
            let lineCoords = [...cleanedCoords];
            const isClosed = lineCoords.length >= 4 && 
              Math.abs(lineCoords[0][0] - lineCoords[lineCoords.length-1][0]) < 0.0001 && 
              Math.abs(lineCoords[0][1] - lineCoords[lineCoords.length-1][1]) < 0.0001;
            
            if (isClosed && lineCoords.length > 3) {
              lineCoords.pop(); // Remove closing coordinate
            }
            
            if (lineCoords.length >= 2) {
              lineStrings.push(lineCoords);
            }
          }
        }

        if (lineStrings.length === 1) {
          return { 
            type: 'LineString', 
            coordinates: lineStrings[0] 
          };
        } else if (lineStrings.length > 1) {
          return { 
            type: 'MultiLineString', 
            coordinates: lineStrings 
          };
        }
      } else {
        // For mixed layers, create appropriate geometry
        const allCoords = memberGroups.flat();
        const cleanedCoords = cleanCoordinates(allCoords);
        
        if (cleanedCoords.length === 1) {
          return { 
            type: 'Point', 
            coordinates: cleanedCoords[0] 
          };
        } else if (cleanedCoords.length > 1) {
          // Try to create centroid
          try {
            const points = turf.points(cleanedCoords);
            const centroid = turf.centroid(points);
            return centroid.geometry;
          } catch (error) {
            return { 
              type: 'Point', 
              coordinates: cleanedCoords[0] 
            };
          }
        }
      }

      return null;
    };

    // Enhanced geometry validation function
    const validateGeometry = (geometry) => {
      try {
        if (!geometry || !geometry.type) return false;

        switch (geometry.type) {
          case 'Point':
            return Array.isArray(geometry.coordinates) && 
              geometry.coordinates.length === 2 && 
              isValidCoordinate(geometry.coordinates);

          case 'LineString':
            return Array.isArray(geometry.coordinates) && 
              geometry.coordinates.length >= 2 &&
              geometry.coordinates.every(coord => isValidCoordinate(coord));

          case 'Polygon':
            return Array.isArray(geometry.coordinates) && 
              geometry.coordinates.length > 0 &&
              Array.isArray(geometry.coordinates[0]) &&
              geometry.coordinates[0].length >= 4 &&
              geometry.coordinates[0].every(coord => isValidCoordinate(coord));

          case 'MultiLineString':
            return Array.isArray(geometry.coordinates) &&
              geometry.coordinates.length > 0 &&
              geometry.coordinates.every(lineString => 
                Array.isArray(lineString) && 
                lineString.length >= 2 &&
                lineString.every(coord => isValidCoordinate(coord))
              );

          case 'MultiPolygon':
            return Array.isArray(geometry.coordinates) &&
              geometry.coordinates.length > 0 &&
              geometry.coordinates.every(polygon =>
                Array.isArray(polygon) &&
                polygon.length > 0 &&
                polygon.every(ring =>
                  Array.isArray(ring) &&
                  ring.length >= 4 &&
                  ring.every(coord => isValidCoordinate(coord))
                )
              );

          default:
            return false;
        }
      } catch (error) {
        console.warn('Geometry validation error:', error);
        return false;
      }
    };

    // Process each layer
    const totalLayers = tagsList.length;
    let processedLayers = 0;
    let savedLayers = 0;

    for (const { tags, filename, domain } of tagsList) {
      try {
        console.log(`Worker processing layer: ${filename} in domain: ${domain}`);
        
        // Build tag query
        let tagQuery = '';
        for (const [key, value] of Object.entries(tags)) {
          if (value === true) {
            tagQuery += `[${key}]`;
          } else if (Array.isArray(value)) {
            for (const val of value) {
              tagQuery += `[${key}="${val}"]`;
            }
          } else {
            tagQuery += `[${key}="${value}"]`;
          }
        }

        // Query based on layer type
        let query;
        if (lineLayers.includes(filename)) {
          // Line layers - use ways and relations for potential MultiLineString
          query = `[out:json][timeout:45];(way${tagQuery}(${bbox});relation${tagQuery}(${bbox}););out geom;`;
        } else {
          // All other layers - use ways and relations
          query = `[out:json][timeout:45];(nwr${tagQuery}(${bbox}););out geom;`;
        }

        // Retry logic for API calls
        let data = null;
        let retryCount = 0;
        const maxRetries = 3;
        
        while (retryCount < maxRetries && !data) {
          try {
            console.log(`Fetching data for ${filename}, attempt ${retryCount + 1}`);
            
            const response = await fetch('https://overpass-api.de/api/interpreter', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: `data=${encodeURIComponent(query)}`,
            });

            if (response.status === 429) {
              const waitTime = Math.pow(2, retryCount) * 3000;
              console.warn(`Rate limited for ${filename}, waiting ${waitTime}ms`);
              await new Promise(resolve => setTimeout(resolve, waitTime));
              retryCount++;
              continue;
            }

            if (response.status === 504 || response.status === 502) {
              const waitTime = Math.pow(2, retryCount) * 5000;
              console.warn(`Server timeout for ${filename}, waiting ${waitTime}ms`);
              await new Promise(resolve => setTimeout(resolve, waitTime));
              retryCount++;
              continue;
            }

            if (!response.ok) {
              console.warn(`Overpass API error for ${filename}: ${response.status}`);
              if (response.status >= 500) {
                retryCount++;
                await new Promise(resolve => setTimeout(resolve, 2000));
                continue;
              } else {
                break;
              }
            }

            data = await response.json();
            console.log(`Successfully fetched ${data.elements?.length || 0} elements for ${filename}`);
            break;
            
          } catch (fetchError) {
            retryCount++;
            console.warn(`Fetch error for ${filename}, attempt ${retryCount}:`, fetchError);
            if (retryCount >= maxRetries) {
              console.warn(`Failed to fetch ${filename} after ${maxRetries} attempts`);
              break;
            }
            const waitTime = Math.pow(2, retryCount - 1) * 2000;
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }
        }

        if (!data || !data.elements || !Array.isArray(data.elements)) {
          console.warn(`No valid data found for ${filename}`);
          continue;
        }
        
        console.log(`Processing ${data.elements.length} elements for ${filename}`);
        
        // Process in smaller batches
        const BATCH_SIZE = 25;
        let processedCount = 0;
        let duplicateCount = 0;
        
        for (let i = 0; i < data.elements.length; i += BATCH_SIZE) {
          const batch = data.elements.slice(i, i + BATCH_SIZE);
          
          for (const el of batch) {
            try {
              if (!el || !el.type) continue;

              let geometry = null;
              
              if (el.type === 'node' && el.lon !== undefined && el.lat !== undefined) {
                // Create proper GeoJSON Point geometry
                const coord = [parseFloat(el.lon), parseFloat(el.lat)];
                if (isValidCoordinate(coord)) {
                  // Check for duplicate point
                  if (isDuplicatePoint(coord)) {
                    duplicateCount++;
                    continue;
                  }
                  
                  geometry = { 
                    type: 'Point', 
                    coordinates: coord
                  };
                }
                
              } else if (el.type === 'way') {
                geometry = processWayGeometry(el, filename);
                
              } else if (el.type === 'relation') {
                geometry = processRelationGeometry(el, filename);
              }

              if (!geometry || !validateGeometry(geometry)) {
                continue;
              }

              // Check for duplicate geometries based on type
              if (geometry.type === 'Point' && isDuplicatePoint(geometry.coordinates)) {
                duplicateCount++;
                continue;
              } else if (geometry.type === 'LineString' && isDuplicateLineString(geometry.coordinates)) {
                duplicateCount++;
                continue;
              } else if (geometry.type === 'MultiLineString' && isDuplicateMultiLineString(geometry.coordinates)) {
                duplicateCount++;
                continue;
              } else if ((geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') && isDuplicateGeometry(geometry)) {
                duplicateCount++;
                continue;
              }

              // Check if feature intersects with boundary
              let isInside = false;
              try {
                const feature = { type: 'Feature', geometry, properties: {} };
                
                if (geometry.type === 'Point') {
                  // Use boundaryFeature which works with both Polygon and MultiPolygon
                  isInside = turf.booleanPointInPolygon(feature, boundaryFeature);
                } else {
                  // booleanIntersects works with MultiPolygon boundaries
                  isInside = turf.booleanIntersects(feature, boundaryFeature);
                }
              } catch (error) {
                console.warn('Intersection test failed, skipping feature:', error);
                continue;
              }

              if (isInside) {
                // Extract proper feature name from OSM tags
                const featureName = el.tags ? 
                  (el.tags.name || el.tags.brand || el.tags.operator || el.tags.ref || null) : null;

                // Crop geometry to boundary if it's a line or polygon
                let finalGeometry = geometry;
                
                if (geometry.type === 'LineString' || geometry.type === 'MultiLineString' || 
                    geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
                  try {
                    const feature = { type: 'Feature', geometry, properties: {} };
                    const boundaryFeature = { 
                      type: 'Feature', 
                      geometry: simplifiedBoundary, 
                      properties: {} 
                    };
                    
                    // Check if feature is completely within boundary
                    const isFullyWithin = turf.booleanWithin(feature, boundaryFeature);
                    
                    if (!isFullyWithin) {
                      // Feature crosses boundary - crop it
                      if (geometry.type === 'LineString') {
                        try {
                          const clipped = turf.bboxClip(feature, turf.bbox(boundaryFeature));
                          if (clipped && clipped.geometry) {
                            finalGeometry = clipped.geometry;
                          }
                        } catch (clipError) {
                          console.warn('Error clipping LineString:', clipError);
                          finalGeometry = geometry;
                        }
                      } else if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
                        try {
                          const intersection = turf.intersect(feature, boundaryFeature);
                          if (intersection && intersection.geometry) {
                            finalGeometry = intersection.geometry;
                          }
                        } catch (intersectError) {
                          console.warn('Error intersecting polygon:', intersectError);
                          finalGeometry = geometry;
                        }
                      } else if (geometry.type === 'MultiLineString') {
                        // Process each line separately
                        try {
                          const croppedLines = [];
                          for (const lineCoords of geometry.coordinates) {
                            const lineFeature = {
                              type: 'Feature',
                              geometry: { type: 'LineString', coordinates: lineCoords },
                              properties: {}
                            };
                            try {
                              const clipped = turf.bboxClip(lineFeature, turf.bbox(boundaryFeature));
                              if (clipped && clipped.geometry && clipped.geometry.coordinates.length >= 2) {
                                croppedLines.push(clipped.geometry.coordinates);
                              }
                            } catch (clipError) {
                              if (lineCoords.length >= 2) {
                                croppedLines.push(lineCoords);
                              }
                            }
                          }
                          if (croppedLines.length > 0) {
                            if (croppedLines.length === 1) {
                              finalGeometry = { type: 'LineString', coordinates: croppedLines[0] };
                            } else {
                              finalGeometry = { type: 'MultiLineString', coordinates: croppedLines };
                            }
                          }
                        } catch (multiLineError) {
                          console.warn('Error processing MultiLineString:', multiLineError);
                          finalGeometry = geometry;
                        }
                      }
                    }
                  } catch (cropError) {
                    console.warn('Error cropping geometry:', cropError);
                    finalGeometry = geometry;
                  }
                }

                // Create feature with cropped geometry
                const feature = {
                  type: 'Feature',
                  geometry: finalGeometry, // Use cropped geometry
                  properties: {
                    name: featureName,
                    geometry_type: finalGeometry.type, // Use cropped geometry type
                    // Include original OSM tags for reference
                    ...(el.tags || {})
                  },
                  // These will be used for parquet columns
                  feature_name: featureName,
                  layer_name: filename,
                  domain_name: domain,
                };

                results.push(feature);
                processedCount++;
              }
              
            } catch (elementError) {
              console.warn('Error processing element:', elementError);
              continue;
            }
          }
          
          // Yield control periodically
          if (i % (BATCH_SIZE * 2) === 0) {
            await new Promise(resolve => setTimeout(resolve, 10));
          }
        }

        console.log(`Completed ${filename}: ${processedCount} features found inside boundary (${duplicateCount} duplicates removed)`);

        // Track if this layer had data
        processedLayers++;
        if (processedCount > 0) {
          savedLayers++;
        }

        // Send progress update
        const progressUpdate = { 
          progress: {
            processed: processedLayers,
            saved: savedLayers,
            total: totalLayers,
            status: 'processing'
          }
        };
        console.log('Worker sending progress update:', progressUpdate);
        self.postMessage(progressUpdate);
        
      } catch (layerError) {
        console.warn(`Error processing layer ${filename}:`, layerError);
        processedLayers++; // Still count failed layers as processed
        
        // Send progress update even on error
        self.postMessage({ 
          progress: {
            processed: processedLayers,
            saved: savedLayers,
            total: totalLayers,
            status: 'processing'
          }
        });
        continue;
      }
      
      // Small delay between layers to avoid overwhelming the API
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`Worker completed processing with ${results.length} total features`);
    self.postMessage({ 
      results,
      progress: {
        processed: processedLayers,
        saved: savedLayers,
        total: totalLayers,
        status: 'complete'
      }
    });
    
  } catch (error) {
    console.error('Worker error:', error);
    self.postMessage({ error: error.message });
  }
};
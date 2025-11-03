importScripts('https://unpkg.com/@turf/turf@6.5.0/turf.min.js');

// Helper function to create a geometry hash for duplicate detection
const getGeometryHash = (geometry) => {
  if (!geometry || !geometry.coordinates) return null;
  
  try {
    // Round coordinates to 6 decimal places for comparison (about 0.1 meter precision)
    const roundCoord = (coord) => {
      if (Array.isArray(coord[0])) {
        return coord.map(roundCoord);
      }
      return [Number(coord[0].toFixed(6)), Number(coord[1].toFixed(6))];
    };
    
    const roundedCoords = roundCoord(geometry.coordinates);
    return `${geometry.type}:${JSON.stringify(roundedCoords)}`;
  } catch (error) {
    console.warn('Error creating geometry hash:', error);
    return null;
  }
};


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

    const clipLineStringByBoundary = (lineCoords, boundaryFeature) => {
      console.log('Clipping LineString with', lineCoords.length, 'points');
      
      // Check if completely within
      const lineFeature = {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: lineCoords },
        properties: {}
      };
      
      try {
        const isFullyWithin = turf.booleanWithin(lineFeature, boundaryFeature);
        
        // CRITICAL: Even if booleanWithin returns true, check if line intersects boundary edge
        let lineIntersectsBoundary = false;
        try {
          const intersections = turf.lineIntersect(lineFeature, boundaryFeature);
          lineIntersectsBoundary = intersections.features.length > 0;
          console.log('Line intersects boundary edge?', lineIntersectsBoundary);
        } catch (intersectError) {
          console.warn('Error checking line intersection with boundary:', intersectError);
        }
        
        if (isFullyWithin && !lineIntersectsBoundary) {
          console.log('LineString is fully within boundary (verified - no edge crossings)');
          return [lineCoords]; // Return as array of segments
        }
      } catch (error) {
        console.warn('Error checking if line is fully within:', error);
      }
      
      console.log('LineString crosses boundary - clipping needed');
      
      // Line crosses boundary - clip it segment by segment
      const clippedSegments = [];
      let currentSegment = [];
      
      for (let i = 0; i < lineCoords.length - 1; i++) {
        const point1 = lineCoords[i];
        const point2 = lineCoords[i + 1];
        
        let p1Inside, p2Inside;
        try {
          p1Inside = turf.booleanPointInPolygon(turf.point(point1), boundaryFeature);
          p2Inside = turf.booleanPointInPolygon(turf.point(point2), boundaryFeature);
        } catch (error) {
          console.warn('Error checking point in polygon:', error);
          continue;
        }
        
        if (p1Inside && p2Inside) {
          // Both points inside - BUT check if this specific segment crosses boundary
          const segment = turf.lineString([point1, point2]);
          let segmentCrossesBoundary = false;
          try {
            const segmentIntersections = turf.lineIntersect(segment, boundaryFeature);
            segmentCrossesBoundary = segmentIntersections.features.length > 0;
          } catch (err) {
            console.warn('Error checking segment intersection:', err);
          }
          
          if (!segmentCrossesBoundary) {
            // Truly inside - add to current segment
            if (currentSegment.length === 0) {
              currentSegment.push(point1);
            }
            currentSegment.push(point2);
          } else {
            // Segment goes outside and comes back in - need to split
            console.log('Segment appears inside but crosses boundary - splitting');
            
            if (currentSegment.length === 0) {
              currentSegment.push(point1);
            }
            
            // Find intersection points
            const intersections = turf.lineIntersect(segment, boundaryFeature);
            if (intersections.features.length >= 2) {
              // Exit and re-entry
              const exitPoint = intersections.features[0].geometry.coordinates;
              const entryPoint = intersections.features[1].geometry.coordinates;
              
              // Complete current segment at exit point
              currentSegment.push(exitPoint);
              if (currentSegment.length >= 2) {
                clippedSegments.push([...currentSegment]);
              }
              
              // Start new segment at entry point
              currentSegment = [entryPoint, point2];
            }
          }
          
        } else if (p1Inside && !p2Inside) {
          // Crossing from inside to outside - find intersection and end segment
          if (currentSegment.length === 0) {
            currentSegment.push(point1);
          }
          
          // Find where this segment crosses the boundary
          const segment = turf.lineString([point1, point2]);
          try {
            const intersections = turf.lineIntersect(segment, boundaryFeature);
            if (intersections.features.length > 0) {
              // Add the intersection point (exit point)
              const exitPoint = intersections.features[0].geometry.coordinates;
              currentSegment.push(exitPoint);
              console.log('Found exit point:', exitPoint);
            }
          } catch (err) {
            console.warn('Error finding exit intersection:', err);
          }
          
          // Save this segment
          if (currentSegment.length >= 2) {
            clippedSegments.push([...currentSegment]);
            console.log('Saved segment with', currentSegment.length, 'points (exiting boundary)');
          }
          currentSegment = [];
          
        } else if (!p1Inside && p2Inside) {
          // Crossing from outside to inside - find intersection and start new segment
          const segment = turf.lineString([point1, point2]);
          try {
            const intersections = turf.lineIntersect(segment, boundaryFeature);
            if (intersections.features.length > 0) {
              // Start new segment with entry point
              const entryPoint = intersections.features[0].geometry.coordinates;
              currentSegment = [entryPoint, point2];
              console.log('Found entry point:', entryPoint);
            } else {
              // No intersection found, start with p2
              currentSegment = [point2];
            }
          } catch (err) {
            console.warn('Error finding entry intersection:', err);
            currentSegment = [point2];
          }
          
        } else {
          // Both points outside
          // Check if segment crosses through the boundary (enters and exits)
          const segment = turf.lineString([point1, point2]);
          try {
            const intersections = turf.lineIntersect(segment, boundaryFeature);
            if (intersections.features.length >= 2) {
              // Segment passes through boundary - keep the middle part
              const entry = intersections.features[0].geometry.coordinates;
              const exit = intersections.features[1].geometry.coordinates;
              clippedSegments.push([entry, exit]);
              console.log('Segment crosses through boundary - keeping middle part');
            }
          } catch (err) {
            console.warn('Error checking segment crossing:', err);
          }
          // If segment doesn't cross boundary, ignore it
        }
      }
      
      // Don't forget the last segment if we were building one
      if (currentSegment.length >= 2) {
        clippedSegments.push(currentSegment);
        console.log('Saved final segment with', currentSegment.length, 'points');
      }
      
      console.log('LineString clipping resulted in', clippedSegments.length, 'segments');
      return clippedSegments;
    };
    
    const clipMultiLineStringByBoundary = (multiLineCoords, boundaryFeature) => {
      console.log('Clipping MultiLineString with', multiLineCoords.length, 'lines');
      const allClippedSegments = [];
      
      for (const lineCoords of multiLineCoords) {
        const lineFeature = {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: lineCoords },
          properties: {}
        };
        
        // Check if this line intersects boundary
        let intersects;
        try {
          intersects = turf.booleanIntersects(lineFeature, boundaryFeature);
        } catch (error) {
          console.warn('Error checking intersection:', error);
          continue;
        }
        
        if (!intersects) {
          continue;
        }
        
        // Check if completely within
        try {
          const isFullyWithin = turf.booleanWithin(lineFeature, boundaryFeature);
          
          // CRITICAL: Even if booleanWithin returns true, check if line intersects boundary edge
          let lineIntersectsBoundary = false;
          try {
            const intersections = turf.lineIntersect(lineFeature, boundaryFeature);
            lineIntersectsBoundary = intersections.features.length > 0;
            console.log('MultiLineString component intersects boundary edge?', lineIntersectsBoundary);
          } catch (intersectError) {
            console.warn('Error checking line intersection with boundary:', intersectError);
          }
          
          if (isFullyWithin && !lineIntersectsBoundary) {
            allClippedSegments.push(lineCoords);
            continue;
          }
        } catch (error) {
          console.warn('Error checking if line is fully within:', error);
        }
        
        // Line crosses boundary - clip it segment by segment
        let currentSegment = [];
        
        for (let i = 0; i < lineCoords.length - 1; i++) {
          const point1 = lineCoords[i];
          const point2 = lineCoords[i + 1];
          
          let p1Inside, p2Inside;
          try {
            p1Inside = turf.booleanPointInPolygon(turf.point(point1), boundaryFeature);
            p2Inside = turf.booleanPointInPolygon(turf.point(point2), boundaryFeature);
          } catch (error) {
            console.warn('Error checking point in polygon:', error);
            continue;
          }
          
          if (p1Inside && p2Inside) {
            // Both points inside - BUT check if this specific segment crosses boundary
            const segment = turf.lineString([point1, point2]);
            let segmentCrossesBoundary = false;
            try {
              const segmentIntersections = turf.lineIntersect(segment, boundaryFeature);
              segmentCrossesBoundary = segmentIntersections.features.length > 0;
            } catch (err) {
              console.warn('Error checking segment intersection:', err);
            }
            
            if (!segmentCrossesBoundary) {
              // Truly inside - add to current segment
              if (currentSegment.length === 0) {
                currentSegment.push(point1);
              }
              currentSegment.push(point2);
            } else {
              // Segment goes outside and comes back in - need to split
              console.log('MultiLineString segment appears inside but crosses boundary - splitting');
              
              if (currentSegment.length === 0) {
                currentSegment.push(point1);
              }
              
              // Find intersection points
              const intersections = turf.lineIntersect(segment, boundaryFeature);
              if (intersections.features.length >= 2) {
                // Exit and re-entry
                const exitPoint = intersections.features[0].geometry.coordinates;
                const entryPoint = intersections.features[1].geometry.coordinates;
                
                // Complete current segment at exit point
                currentSegment.push(exitPoint);
                if (currentSegment.length >= 2) {
                  allClippedSegments.push([...currentSegment]);
                }
                
                // Start new segment at entry point
                currentSegment = [entryPoint, point2];
              }
            }
            
          } else if (p1Inside && !p2Inside) {
            // Exit boundary
            if (currentSegment.length === 0) {
              currentSegment.push(point1);
            }
            
            const segment = turf.lineString([point1, point2]);
            try {
              const intersections = turf.lineIntersect(segment, boundaryFeature);
              if (intersections.features.length > 0) {
                currentSegment.push(intersections.features[0].geometry.coordinates);
              }
            } catch (err) {
              console.warn('Error finding exit intersection:', err);
            }
            
            if (currentSegment.length >= 2) {
              allClippedSegments.push([...currentSegment]);
            }
            currentSegment = [];
            
          } else if (!p1Inside && p2Inside) {
            // Enter boundary
            const segment = turf.lineString([point1, point2]);
            try {
              const intersections = turf.lineIntersect(segment, boundaryFeature);
              if (intersections.features.length > 0) {
                currentSegment = [intersections.features[0].geometry.coordinates, point2];
              } else {
                currentSegment = [point2];
              }
            } catch (err) {
              console.warn('Error finding entry intersection:', err);
              currentSegment = [point2];
            }
            
          } else {
            // Both outside - check for pass-through
            const segment = turf.lineString([point1, point2]);
            try {
              const intersections = turf.lineIntersect(segment, boundaryFeature);
              if (intersections.features.length >= 2) {
                allClippedSegments.push([
                  intersections.features[0].geometry.coordinates,
                  intersections.features[1].geometry.coordinates
                ]);
              }
            } catch (err) {
              console.warn('Error checking segment crossing:', err);
            }
          }
        }
        
        if (currentSegment.length >= 2) {
          allClippedSegments.push(currentSegment);
        }
      }
      
      console.log('MultiLineString clipping resulted in', allClippedSegments.length, 'segments');
      return allClippedSegments;
    };

    const results = [];
    
    // Duplicate detection sets
    const seenPoints = new Set();
    const seenLineStrings = new Set();
    const seenGeometries = new Set();

    // Helper function to check for duplicate points
    const isDuplicatePoint = (coord) => {
      const hash = `${coord[0].toFixed(6)},${coord[1].toFixed(6)}`;
      if (seenPoints.has(hash)) {
        return true;
      }
      seenPoints.add(hash);
      return false;
    };

    // Helper function to check for duplicate LineStrings
    const isDuplicateLineString = (coordinates) => {
      const hash = coordinates
        .map(coord => `${coord[0].toFixed(6)},${coord[1].toFixed(6)}`)
        .join('|');
      if (seenLineStrings.has(hash)) {
        return true;
      }
      seenLineStrings.add(hash);
      return false;
    };

    // Helper function to check for duplicate MultiLineStrings
    const isDuplicateMultiLineString = (coordinates) => {
      const hash = coordinates
        .map(line => line.map(coord => `${coord[0].toFixed(6)},${coord[1].toFixed(6)}`).join('|'))
        .join('||');
      if (seenLineStrings.has(hash)) {
        return true;
      }
      seenLineStrings.add(hash);
      return false;
    };

    // Helper function to check for duplicate geometries
    const isDuplicateGeometry = (geometry) => {
      const hash = getGeometryHash(geometry);
      if (!hash) return false;
      
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

              if (isDuplicateGeometry(geometry)) {
                duplicateCount++;
                continue;
              }

              // Check if feature intersects with boundary
              let isInside = false;
              try {
                const feature = { type: 'Feature', geometry, properties: {} };
                
                if (geometry.type === 'Point') {
                  isInside = turf.booleanPointInPolygon(feature, boundaryFeature);
                } else {
                  isInside = turf.booleanIntersects(feature, boundaryFeature);
                }
              } catch (error) {
                console.warn('Intersection test failed, skipping feature:', error);
                continue;
              }

              if (isInside) {
                const featureName = el.tags ? 
                  (el.tags.name || el.tags.brand || el.tags.operator || el.tags.ref || null) : null;
              
                // Crop geometry
                let finalGeometry = geometry;
                
                if (geometry.type === 'LineString') {
                  try {
                    console.log(`Processing LineString with ${geometry.coordinates.length} points`);
                    
                    const clippedSegments = clipLineStringByBoundary(geometry.coordinates, boundaryFeature);
                    
                    if (clippedSegments.length === 0) {
                      console.log('LineString completely outside boundary');
                      continue;
                    } else if (clippedSegments.length === 1) {
                      finalGeometry = {
                        type: 'LineString',
                        coordinates: clippedSegments[0]
                      };
                    } else {
                      finalGeometry = {
                        type: 'MultiLineString',
                        coordinates: clippedSegments
                      };
                    }
                  } catch (clipError) {
                    console.error('Error clipping LineString:', clipError);
                    // Skip feature if clipping fails completely
                    continue;
                  }
                  
                } else if (geometry.type === 'MultiLineString') {
                  try {
                    console.log(`Processing MultiLineString with ${geometry.coordinates.length} lines`);
                    
                    const clippedSegments = clipMultiLineStringByBoundary(geometry.coordinates, boundaryFeature);
                    
                    if (clippedSegments.length === 0) {
                      console.log('MultiLineString completely outside boundary');
                      continue;
                    } else if (clippedSegments.length === 1) {
                      finalGeometry = {
                        type: 'LineString',
                        coordinates: clippedSegments[0]
                      };
                    } else {
                      finalGeometry = {
                        type: 'MultiLineString',
                        coordinates: clippedSegments
                      };
                    }
                  } catch (clipError) {
                    console.error('Error clipping MultiLineString:', clipError);
                    // Skip feature if clipping fails completely
                    continue;
                  }

                } else if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
                  // Keep existing polygon clipping logic
                  try {
                    const feature = { type: 'Feature', geometry, properties: {} };
                    const isFullyWithin = turf.booleanWithin(feature, boundaryFeature);
                    
                    if (!isFullyWithin) {
                      const intersection = turf.intersect(feature, boundaryFeature);
                      if (intersection && intersection.geometry) {
                        finalGeometry = intersection.geometry;
                      } else {
                        finalGeometry = null;
                      }
                    }
                  } catch (intersectError) {
                    console.warn('Error intersecting polygon:', intersectError);
                    finalGeometry = geometry;
                  }
                }
              
                if (!finalGeometry) {
                  continue;
                }
                
                // Create feature with geometry
                const feature = {
                  type: 'Feature',
                  geometry: finalGeometry,
                  properties: {
                    name: featureName,
                    geometry_type: finalGeometry.type,
                    ...(el.tags || {})
                  },
                  feature_name: featureName,
                  layer_name: filename,
                  domain_name: domain,
                };

                if (geometry.type === 'LineString' || geometry.type === 'MultiLineString') {
                  console.log(`[WORKER] Created feature for ${filename}:`, {
                    originalType: geometry.type,
                    originalCoordCount: geometry.type === 'LineString' 
                      ? geometry.coordinates.length 
                      : geometry.coordinates.reduce((sum, line) => sum + line.length, 0),
                    finalType: finalGeometry.type,
                    finalCoordCount: finalGeometry.type === 'LineString' 
                      ? finalGeometry.coordinates.length 
                      : finalGeometry.coordinates.reduce((sum, line) => sum + line.length, 0),
                    wasCropped: JSON.stringify(geometry) !== JSON.stringify(finalGeometry)
                  });
                }

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
        processedLayers++;
        
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
//checks to see if the scraped data matches any of the previous tables in sql 
  import React, { useState, useEffect } from 'react';
  
  const MyComponent = () => {
    const [mergedData, setMergedData] = useState([]);
    const [processedData, setProcessedData] = useState([]);
    const [error, setError] = useState(null);
  
    useEffect(() => {
      // Assuming you have mergedData available
  
      const handleProcessData = async () => {
        setError(null);
  
        try {
          const response = await fetch('/api/processData', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mergedData }),
          });
  
          const data = await response.json();
  
          if (data.error) {
            setError(data.error);
          } else {
            setProcessedData(data.processedData);
          }
        } catch (error) {
          console.error(error);
          setError('Failed to process data');
        }
      };
  
      handleProcessData();
    }, [mergedData]); // Re-run useEffect when mergedData changes
  
    // ... (rest of your component)
  
    return (
      <div>
        {error && <p>Error: {error}</p>}
        {processedData.length > 0 && (
          <ul>
            {processedData.map((item) => (
              <li key={item.link.href}>
                {item.link.href} - {item.exists ? 'Exists' : 'Not Found'}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };
  
  export default MyComponent;
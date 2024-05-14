const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000; // Use port 3000 by default, or get port from environment variable

// Serve static files from the 'build' directory
app.use(express.static(path.join(__dirname, '..', 'ui', 'build')));

// Route for serving the index.html file (for client-side routing)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'ui', 'build', 'index.html'));
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
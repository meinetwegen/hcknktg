import SwaggerUI from 'swagger-ui-react';
import 'swagger-ui-react/swagger-ui.css';

const SwaggerPanel = () => {
  return (
    <div className="mt-6 p-6 border rounded-xl bg-white/5">
      <h2 className="text-xl font-black mb-4">API Documentation</h2>
      <SwaggerUI url="https://www.google.com/search?q=http://localhost:3000/openapi.json" />
    </div>
  );
};

export default SwaggerPanel;
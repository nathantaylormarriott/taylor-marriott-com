import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Shell from './layout/Shell';
import Contact from './pages/Contact';
import DiscoverySession from './pages/DiscoverySession';
import ForMuslims from './pages/ForMuslims';
import Home from './pages/Home';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Home />} />
          <Route path="contact" element={<Contact />} />
          <Route path="discovery-session" element={<DiscoverySession />} />
          <Route path="for-muslims" element={<ForMuslims />} />
          <Route path="portal" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

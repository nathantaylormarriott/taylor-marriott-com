import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Shell from './layout/Shell';
import Home from './pages/Home';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Home />} />
          <Route path="contact" element={<Navigate to="/" replace state={{ openContact: true }} />} />
          <Route path="portal" element={<Navigate to="/" replace state={{ openPortal: true }} />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

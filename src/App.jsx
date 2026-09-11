import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Shell from './layout/Shell';
import Contact from './pages/Contact';
import Home from './pages/Home';
import Ops from './pages/Ops';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Home />} />
          <Route path="contact" element={<Contact />} />
          <Route path="admin" element={<Ops />} />
          <Route path="ops" element={<Navigate to="/admin" replace />} />
          <Route path="portal" element={<Navigate to="/" replace state={{ openPortal: true }} />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

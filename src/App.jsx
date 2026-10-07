import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Shell from './layout/Shell';
import Contact from './pages/Contact';
import DiscoverySession from './pages/DiscoverySession';
import ForMuslims from './pages/ForMuslims';
import Home from './pages/Home';
import Pipeline from './pages/Pipeline';
import WebsiteForYourBusiness from './pages/WebsiteForYourBusiness';
import Checkout from './pages/Checkout';
import CheckoutDone from './pages/CheckoutDone';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Home />} />
          <Route path="contact" element={<Contact />} />
          <Route path="discovery-session" element={<DiscoverySession />} />
          <Route path="for-muslims" element={<ForMuslims />} />
          <Route path="website-for-your-business" element={<WebsiteForYourBusiness />} />
          <Route path="pipeline" element={<Pipeline />} />
          <Route path="checkout" element={<Checkout />} />
          <Route path="checkout/done" element={<CheckoutDone />} />
          <Route path="portal" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

'use client';

import { useState } from 'react';
import MasterRatesTab from './_components/MasterRatesTab';
import ProductsTab from './_components/ProductsTab';
import AccessoriesTab from './_components/AccessoriesTab';
import MaterialsTab from './_components/MaterialsTab';

const TABS = [
  { id: 'master-rates', label: 'Master Rates' },
  { id: 'products', label: 'Products' },
  { id: 'accessories', label: 'Accessories' },
  { id: 'materials', label: 'Materials' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function PricingPage() {
  const [activeTab, setActiveTab] = useState<TabId>('master-rates');

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-xl font-semibold text-gray-900 mb-6">Pricing</h1>

      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-0">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      <div>
        {activeTab === 'master-rates' && <MasterRatesTab />}
        {activeTab === 'products' && <ProductsTab />}
        {activeTab === 'accessories' && <AccessoriesTab />}
        {activeTab === 'materials' && <MaterialsTab />}
      </div>
    </div>
  );
}

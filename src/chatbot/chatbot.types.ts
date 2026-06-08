export type ChatbotProductStatus =
  | 'DISPONIBLE'
  | 'BAJO_MINIMO'
  | 'SIN_STOCK'
  | 'REQUIERE_AJUSTE';

export type ChatbotProduct = {
  codigo: string;
  descrip: string;
  stock: number;
  minStock: number;
  status: ChatbotProductStatus;
};

export type InventorySummary = {
  totalProducts: number;
  totalUnits: number;
  availableProducts: number;
  lowStockProducts: number;
  outOfStockProducts: number;
  adjustmentProducts: number;
};

export type ChatbotResponse = {
  type:
    | 'GENERAL'
    | 'PRODUCT'
    | 'PRODUCT_LIST'
    | 'INVENTORY_SUMMARY'
    | 'NOT_FOUND';
  answer: string;
  product?: ChatbotProduct | null;
  products?: ChatbotProduct[];
  totalResults?: number;
  summary?: InventorySummary;
};
module.exports = {
  PRODUKSI: {
    label: 'Produksi',
    full: 'Request Produksi',
    passwordEnvPrefix: 'PASS_PRODUKSI_',
    apiPermissions: ['planning', 'addItem', 'pengambilan'],
    uiPermissions: {
      canAddItem: true,
      canDeleteItem: false,
      canEditWhReady: false,
      canEditPengambilan: false
    }
  },
  MARKETING: {
    label: 'Marketing',
    full: 'Marketing Ready & Taken',
    passwordEnv: 'PASS_MARKETING',
    apiPermissions: ['addItem', 'importSpk', 'exportFile', 'whReady', 'pengambilan', 'returanAdd', 'returanConfirm'],
    uiPermissions: {
      canAddItem: true,
      canImportSpk: true,
      canExportFiles: true,
      canDeleteItem: false,
      canEditWhReady: true,
      canEditPengambilan: true
    }
  },
  MASTER: {
    label: 'Master',
    full: 'Akses penuh',
    passwordEnv: 'PASS_MASTER',
    apiPermissions: ['planning', 'addItem', 'importSpk', 'exportFile', 'whReady', 'pengambilan', 'returanAdd', 'returanConfirm'],
    uiPermissions: {
      canAddItem: true,
      canImportSpk: true,
      canExportFiles: true,
      canDeleteItem: true,
      canEditWhReady: true,
      canEditPengambilan: true
    }
  }
};
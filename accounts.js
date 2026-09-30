module.exports = {
  PRODUKSI: {
    label: 'Produksi',
    full: 'Request Produksi',
    passwordEnv: 'PASS_PRODUKSI',
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
    apiPermissions: ['whReady', 'pengambilan', 'returanAdd', 'returanConfirm'],
    uiPermissions: {
      canAddItem: false,
      canDeleteItem: false,
      canEditWhReady: true,
      canEditPengambilan: true
    }
  },
  MASTER: {
    label: 'Master',
    full: 'Akses penuh',
    passwordEnv: 'PASS_MASTER',
    apiPermissions: ['planning', 'addItem', 'whReady', 'pengambilan', 'returanAdd', 'returanConfirm'],
    uiPermissions: {
      canAddItem: true,
      canDeleteItem: true,
      canEditWhReady: true,
      canEditPengambilan: true
    }
  }
};
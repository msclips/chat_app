const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const NgoMaster = sequelize.define('NgoMaster', {
    ngo_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    ngo_logo_path: {
        type: DataTypes.STRING(255),
        allowNull: true,
    }
}, {
    tableName: 'ngo_master',
    timestamps: false
});

module.exports = NgoMaster;

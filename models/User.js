const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const User = sequelize.define('User', {
   user_id: {
            type: DataTypes.BIGINT.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
            allowNull: true,
        }, user_name: {
            type: DataTypes.STRING(120),
            allowNull: false,
            unique: true
        }, password: {
            type: DataTypes.STRING(120),
            allowNull: false
        }, file_path: {
            type: DataTypes.STRING(255),
            allowNull: true
        }
}, {
  tableName: 'user_master',
  timestamps: false // Assuming user_master doesn't have standard Sequelize timestamps
});

module.exports = User;

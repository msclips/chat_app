const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const UserToken = sequelize.define('UserToken', {
    user_token_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true
    },    
    user_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true
    },
    android_token: {
        type: DataTypes.STRING(512),
        allowNull: true
    }, 
    web_token: {
        type: DataTypes.STRING(512),
        allowNull: true
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    }
}, {
    tableName: 'user_tokens',
    timestamps: false
});

module.exports = UserToken;

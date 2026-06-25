const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const GroupRequest = sequelize.define('GroupRequest', {
    id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
    },
    group_name: {
        type: DataTypes.STRING(150),
        allowNull: false,
    },
    description: {
        type: DataTypes.STRING(1000),
        allowNull: true,
    },
    requested_by: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
    },
    requested_by_name: {
        type: DataTypes.STRING(150),
        allowNull: true,
    },
    status: {
        type: DataTypes.ENUM('pending', 'approved', 'rejected'),
        allowNull: false,
        defaultValue: 'pending',
    },
    rejection_reason: {
        type: DataTypes.STRING(500),
        allowNull: true,
    },
    updated_by: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
    },
    group_id: {
        // MySQL GroupMaster ID — set on approval
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
    },
    created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
    },
    updated_at: {
        type: DataTypes.DATE,
        allowNull: true,
    },
}, {
    tableName: 'group_requests',
    timestamps: false,
});

module.exports = GroupRequest;

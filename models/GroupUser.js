const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const GroupUser = sequelize.define('GroupUser', {
    group_user_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
    },
    group_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
    },
    user_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
    },
    role: {
        type: DataTypes.TINYINT,
        allowNull: true,
        comment: "1=admin, 2=member, etc"
    },
    status: {
        type: DataTypes.TINYINT,
        allowNull: true,
        comment: "0=pending, 1=approved, 2=rejected"
    },
    joined_at: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    last_seen_at: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: 1,
    },
    created_by: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
    },
    created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
    },
    updated_by: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
    },
    updated_at: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    deleted_by: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
    },
    deleted_at: {
        type: DataTypes.DATE,
        allowNull: true,
    },
}, {
    tableName: "group_user",
    timestamps: false,
    paranoid: false,
    defaultScope: {
        attributes: {
            exclude: [
                "created_by",
                "modified_by",
                "deleted_by",
                "deleted_at",
                "is_active",
                "created_at",
                "modified_at",
            ],
        },
    },
});

module.exports = GroupUser;

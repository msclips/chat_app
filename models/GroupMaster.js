const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const GroupMaster = sequelize.define('GroupMaster', {
    group_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
    },
    group_uid: {
        type: DataTypes.STRING(50),
        allowNull: true,
    },
    group_name: {
        type: DataTypes.STRING(150),
        allowNull: true,
    },
    description: {
        type: DataTypes.STRING(1000),
        allowNull: true,
    },
    is_ngo_group: {
        type: DataTypes.TINYINT(1),
        allowNull: true,
    },
    category: {
        type: DataTypes.ENUM('community', 'chat', 'channel', 'team', 'project'),
        allowNull: true,
    },
    parent_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
    },
    user_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
    },
    ngo_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
    image_name: {
        type: DataTypes.STRING(300),
        allowNull: true,
    },
    image_path: {
        type: DataTypes.STRING(700),
        allowNull: true,
    },
    image_s3_url: {
        type: DataTypes.STRING(700),
        allowNull: true,
    },
    cover_image_name: {
        type: DataTypes.STRING(300),
        allowNull: true,
    },
    cover_image_path: {
        type: DataTypes.STRING(700),
        allowNull: true,
    },
    cover_image_s3_url: {
        type: DataTypes.STRING(700),
        allowNull: true,
    },
    is_public: {
        type: DataTypes.TINYINT(1),
        allowNull: true,
    },
    is_searchable: {
        type: DataTypes.TINYINT(1),
        allowNull: true,
    },
    is_active: {
        type: DataTypes.TINYINT(1),
        allowNull: true,
    },
    is_archived: {
        type: DataTypes.TINYINT(1),
        allowNull: true,
    },
    total_groups: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: true,
    },
    total_admins: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: true,
    },
    total_users: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: true,
    },
    settings: {
        type: DataTypes.JSON,
        allowNull: true,
    },
    created_by_name: {
        type: DataTypes.STRING(150),
        allowNull: true,
    },
    created_at: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: DataTypes.NOW,
    },
    created_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
    updated_at: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    updated_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
}, {
    tableName: "groups_master",
    timestamps: false,
    underscored: true,
});

module.exports = GroupMaster;

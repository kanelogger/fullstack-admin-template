-- PC Admin 数据库 Schema
-- 数据库: admin_template
-- 兼容: MySQL 8.0+

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------
-- 1. 组织与用户
-- ---------------------------------------------------------
DROP TABLE IF EXISTS `departments`;
CREATE TABLE `departments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `dept_code` VARCHAR(64) NOT NULL COMMENT '部门编码',
  `dept_name` VARCHAR(128) NOT NULL COMMENT '部门名称',
  `status` TINYINT NOT NULL DEFAULT 1 COMMENT '状态：0-停用，1-启用',
  `description` VARCHAR(255) DEFAULT NULL COMMENT '部门说明',
  `created_by` BIGINT UNSIGNED DEFAULT NULL COMMENT '创建人',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_by` BIGINT UNSIGNED DEFAULT NULL COMMENT '更新人',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '逻辑删除标志：0-正常，1-删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_departments_dept_code` (`dept_code`),
  KEY `idx_departments_status_deleted` (`status`, `deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='部门信息表';

DROP TABLE IF EXISTS `posts`;
CREATE TABLE `posts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `post_code` VARCHAR(64) NOT NULL COMMENT '岗位编码',
  `post_name` VARCHAR(128) NOT NULL COMMENT '岗位名称',
  `status` TINYINT NOT NULL DEFAULT 1 COMMENT '状态：0-停用，1-启用',
  `description` VARCHAR(255) DEFAULT NULL COMMENT '岗位说明',
  `created_by` BIGINT UNSIGNED DEFAULT NULL COMMENT '创建人',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_by` BIGINT UNSIGNED DEFAULT NULL COMMENT '更新人',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '逻辑删除标志：0-正常，1-删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_posts_post_code` (`post_code`),
  KEY `idx_posts_status_deleted` (`status`, `deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='岗位信息表';

DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_code` VARCHAR(64) NOT NULL COMMENT '用户工号',
  `login_name` VARCHAR(64) NOT NULL COMMENT '登录名',
  `password_hash` VARCHAR(255) NOT NULL COMMENT '加密密码',
  `display_name` VARCHAR(128) NOT NULL COMMENT '中文姓名',
  `phone` VARCHAR(32) DEFAULT NULL COMMENT '手机号',
  `email` VARCHAR(128) DEFAULT NULL COMMENT '邮箱',
  `avatar_url` VARCHAR(512) DEFAULT NULL COMMENT '头像地址',
  `dept_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '所属部门 ID',
  `post_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '所属岗位 ID',
  `status` TINYINT NOT NULL DEFAULT 1 COMMENT '状态：0-停用，1-启用',
  `last_login_at` DATETIME DEFAULT NULL COMMENT '最近登录时间',
  `created_by` BIGINT UNSIGNED DEFAULT NULL COMMENT '创建人',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_by` BIGINT UNSIGNED DEFAULT NULL COMMENT '更新人',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '逻辑删除标志：0-正常，1-删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_users_user_code` (`user_code`),
  UNIQUE KEY `uk_users_login_name` (`login_name`),
  KEY `idx_users_login_name` (`login_name`),
  KEY `idx_users_user_code` (`user_code`),
  KEY `idx_users_display_name` (`display_name`),
  KEY `idx_users_dept_post_status_deleted` (`dept_id`, `post_id`, `status`, `deleted`),
  CONSTRAINT `fk_users_dept_id` FOREIGN KEY (`dept_id`) REFERENCES `departments` (`id`),
  CONSTRAINT `fk_users_post_id` FOREIGN KEY (`post_id`) REFERENCES `posts` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户信息表';

-- ---------------------------------------------------------
-- 2. 角色与菜单权限
-- ---------------------------------------------------------
DROP TABLE IF EXISTS `roles`;
CREATE TABLE `roles` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `role_code` VARCHAR(64) NOT NULL COMMENT '角色编码',
  `role_name` VARCHAR(128) NOT NULL COMMENT '角色名称',
  `status` TINYINT NOT NULL DEFAULT 1 COMMENT '状态：0-停用，1-启用',
  `description` VARCHAR(255) DEFAULT NULL COMMENT '角色说明',
  `is_super_admin` TINYINT NOT NULL DEFAULT 0 COMMENT '是否超级管理员角色：0-否，1-是',
  `created_by` BIGINT UNSIGNED DEFAULT NULL COMMENT '创建人',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_by` BIGINT UNSIGNED DEFAULT NULL COMMENT '更新人',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '逻辑删除标志：0-正常，1-删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_roles_role_code` (`role_code`),
  KEY `idx_roles_status_deleted` (`status`, `deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='角色信息表';

DROP TABLE IF EXISTS `user_roles`;
CREATE TABLE `user_roles` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL COMMENT '用户 ID',
  `role_id` BIGINT UNSIGNED NOT NULL COMMENT '角色 ID',
  `created_by` BIGINT UNSIGNED DEFAULT NULL COMMENT '创建人',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_by` BIGINT UNSIGNED DEFAULT NULL COMMENT '更新人',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '逻辑删除标志：0-正常，1-删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_roles_user_role_deleted` (`user_id`, `role_id`, `deleted`),
  KEY `idx_user_roles_user_id_deleted` (`user_id`, `deleted`),
  CONSTRAINT `fk_user_roles_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_user_roles_role_id` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户角色关联表';

DROP TABLE IF EXISTS `menus`;
CREATE TABLE `menus` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `menu_code` VARCHAR(64) NOT NULL COMMENT '菜单编码',
  `menu_name` VARCHAR(128) NOT NULL COMMENT '菜单名称',
  `parent_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '父级菜单 ID',
  `icon` VARCHAR(128) DEFAULT NULL COMMENT '菜单图标',
  `sort_order` INT NOT NULL DEFAULT 0 COMMENT '同父级排序号',
  `route_path` VARCHAR(255) NOT NULL COMMENT '路由地址',
  `component_path` VARCHAR(255) DEFAULT NULL COMMENT '前端组件路径',
  `visible` TINYINT NOT NULL DEFAULT 1 COMMENT '显示状态：0-隐藏，1-显示',
  `status` TINYINT NOT NULL DEFAULT 1 COMMENT '菜单状态：0-停用，1-启用',
  `meta_json` JSON DEFAULT NULL COMMENT '路由扩展元数据',
  `created_by` BIGINT UNSIGNED DEFAULT NULL COMMENT '创建人',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_by` BIGINT UNSIGNED DEFAULT NULL COMMENT '更新人',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '逻辑删除标志：0-正常，1-删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_menus_menu_code` (`menu_code`),
  KEY `idx_menus_parent_sort_status_deleted` (`parent_id`, `sort_order`, `status`, `deleted`),
  CONSTRAINT `fk_menus_parent_id` FOREIGN KEY (`parent_id`) REFERENCES `menus` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='菜单信息表';

DROP TABLE IF EXISTS `role_menus`;
CREATE TABLE `role_menus` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `role_id` BIGINT UNSIGNED NOT NULL COMMENT '角色 ID',
  `menu_id` BIGINT UNSIGNED NOT NULL COMMENT '菜单 ID',
  `created_by` BIGINT UNSIGNED DEFAULT NULL COMMENT '创建人',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_by` BIGINT UNSIGNED DEFAULT NULL COMMENT '更新人',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '逻辑删除标志：0-正常，1-删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_role_menus_role_menu_deleted` (`role_id`, `menu_id`, `deleted`),
  KEY `idx_role_menus_role_id_deleted` (`role_id`, `deleted`),
  CONSTRAINT `fk_role_menus_role_id` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`),
  CONSTRAINT `fk_role_menus_menu_id` FOREIGN KEY (`menu_id`) REFERENCES `menus` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='角色菜单关联表';

-- ---------------------------------------------------------
-- 3. 数据字典与系统配置
-- ---------------------------------------------------------
DROP TABLE IF EXISTS `dict_types`;
CREATE TABLE `dict_types` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `dict_code` VARCHAR(64) NOT NULL COMMENT '字典类型编码',
  `dict_name` VARCHAR(128) NOT NULL COMMENT '字典类型名称',
  `status` TINYINT NOT NULL DEFAULT 1 COMMENT '状态：0-停用，1-启用',
  `description` VARCHAR(255) DEFAULT NULL COMMENT '说明',
  `created_by` BIGINT UNSIGNED DEFAULT NULL COMMENT '创建人',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_by` BIGINT UNSIGNED DEFAULT NULL COMMENT '更新人',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '逻辑删除标志：0-正常，1-删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_dict_types_dict_code` (`dict_code`),
  KEY `idx_dict_types_status_deleted` (`status`, `deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='字典类型表';

DROP TABLE IF EXISTS `dict_items`;
CREATE TABLE `dict_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `dict_type_id` BIGINT UNSIGNED NOT NULL COMMENT '字典类型 ID',
  `item_value` VARCHAR(64) NOT NULL COMMENT '字典值',
  `item_label` VARCHAR(128) NOT NULL COMMENT '字典标签',
  `sort_order` INT NOT NULL DEFAULT 0 COMMENT '排序号',
  `status` TINYINT NOT NULL DEFAULT 1 COMMENT '状态：0-停用，1-启用',
  `description` VARCHAR(255) DEFAULT NULL COMMENT '说明',
  `created_by` BIGINT UNSIGNED DEFAULT NULL COMMENT '创建人',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_by` BIGINT UNSIGNED DEFAULT NULL COMMENT '更新人',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '逻辑删除标志：0-正常，1-删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_dict_items_type_value_deleted` (`dict_type_id`, `item_value`, `deleted`),
  KEY `idx_dict_items_type_status_sort_deleted` (`dict_type_id`, `status`, `sort_order`, `deleted`),
  CONSTRAINT `fk_dict_items_dict_type_id` FOREIGN KEY (`dict_type_id`) REFERENCES `dict_types` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='字典项表';

DROP TABLE IF EXISTS `system_configs`;
CREATE TABLE `system_configs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `config_code` VARCHAR(64) NOT NULL COMMENT '配置编码',
  `config_name` VARCHAR(128) NOT NULL COMMENT '配置名称',
  `config_value` TEXT NOT NULL COMMENT '配置值',
  `value_type` VARCHAR(32) NOT NULL DEFAULT 'STRING' COMMENT '值类型：STRING、NUMBER、BOOLEAN、JSON',
  `status` TINYINT NOT NULL DEFAULT 1 COMMENT '状态：0-停用，1-启用',
  `description` VARCHAR(255) DEFAULT NULL COMMENT '配置说明',
  `created_by` BIGINT UNSIGNED DEFAULT NULL COMMENT '创建人',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_by` BIGINT UNSIGNED DEFAULT NULL COMMENT '更新人',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '逻辑删除标志：0-正常，1-删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_system_configs_config_code` (`config_code`),
  KEY `idx_system_configs_status_deleted` (`status`, `deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统配置表';

-- ---------------------------------------------------------
-- 4. 文件附件与消息
-- ---------------------------------------------------------
DROP TABLE IF EXISTS `attachments`;
CREATE TABLE `attachments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `original_name` VARCHAR(255) NOT NULL COMMENT '原始文件名',
  `stored_name` VARCHAR(255) NOT NULL COMMENT '存储文件名',
  `file_url` VARCHAR(512) NOT NULL COMMENT '访问地址',
  `mime_type` VARCHAR(128) NOT NULL COMMENT 'MIME 类型',
  `file_ext` VARCHAR(32) NOT NULL COMMENT '文件后缀',
  `file_size` BIGINT UNSIGNED NOT NULL COMMENT '文件大小，单位 byte',
  `file_hash` VARCHAR(128) DEFAULT NULL COMMENT '文件摘要',
  `business_module` VARCHAR(64) DEFAULT NULL COMMENT '业务模块',
  `business_record_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '业务记录 ID',
  `reference_status` TINYINT NOT NULL DEFAULT 1 COMMENT '引用状态：0-未引用，1-已引用',
  `upload_user_id` BIGINT UNSIGNED NOT NULL COMMENT '上传人',
  `uploaded_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '上传时间',
  `created_by` BIGINT UNSIGNED DEFAULT NULL COMMENT '创建人',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_by` BIGINT UNSIGNED DEFAULT NULL COMMENT '更新人',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '逻辑删除标志：0-正常，1-删除',
  PRIMARY KEY (`id`),
  KEY `idx_attachments_business_deleted` (`business_module`, `business_record_id`, `deleted`),
  KEY `idx_attachments_user_uploaded` (`upload_user_id`, `uploaded_at`),
  CONSTRAINT `fk_attachments_upload_user_id` FOREIGN KEY (`upload_user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='附件元数据表';

DROP TABLE IF EXISTS `messages`;
CREATE TABLE `messages` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `receiver_id` BIGINT UNSIGNED NOT NULL COMMENT '接收人 ID',
  `sender_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '发送人 ID，系统消息可为空',
  `title` VARCHAR(128) NOT NULL COMMENT '消息标题',
  `summary` VARCHAR(255) DEFAULT NULL COMMENT '消息摘要',
  `content` TEXT NOT NULL COMMENT '消息内容',
  `message_type` VARCHAR(32) NOT NULL DEFAULT 'NOTICE' COMMENT '消息类型',
  `read_status` TINYINT NOT NULL DEFAULT 0 COMMENT '已读状态：0-未读，1-已读',
  `sent_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '发送时间',
  `read_at` DATETIME DEFAULT NULL COMMENT '阅读时间',
  `created_by` BIGINT UNSIGNED DEFAULT NULL COMMENT '创建人',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_by` BIGINT UNSIGNED DEFAULT NULL COMMENT '更新人',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '逻辑删除标志：0-正常，1-删除',
  PRIMARY KEY (`id`),
  KEY `idx_messages_receiver_read_sent_deleted` (`receiver_id`, `read_status`, `sent_at`, `deleted`),
  CONSTRAINT `fk_messages_receiver_id` FOREIGN KEY (`receiver_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_messages_sender_id` FOREIGN KEY (`sender_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='站内消息表';

-- ---------------------------------------------------------
-- 5. 日志审计
-- ---------------------------------------------------------
DROP TABLE IF EXISTS `login_logs`;
CREATE TABLE `login_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '登录用户 ID，失败时可为空',
  `login_name` VARCHAR(64) NOT NULL COMMENT '登录名',
  `login_ip` VARCHAR(64) DEFAULT NULL COMMENT '登录 IP',
  `user_agent` VARCHAR(512) DEFAULT NULL COMMENT '浏览器标识',
  `login_result` TINYINT NOT NULL COMMENT '登录结果：0-失败，1-成功',
  `failure_reason` VARCHAR(255) DEFAULT NULL COMMENT '失败原因',
  `logged_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '登录时间',
  PRIMARY KEY (`id`),
  KEY `idx_login_logs_login_name_logged_at` (`login_name`, `logged_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='登录日志表';

DROP TABLE IF EXISTS `operation_logs`;
CREATE TABLE `operation_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `operator_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '操作人 ID',
  `operator_name` VARCHAR(128) DEFAULT NULL COMMENT '操作人名称快照',
  `module_code` VARCHAR(64) NOT NULL COMMENT '操作模块',
  `operation_type` VARCHAR(32) NOT NULL COMMENT '操作类型：CREATE、UPDATE、DELETE 等',
  `request_method` VARCHAR(16) NOT NULL COMMENT '请求方法',
  `request_path` VARCHAR(255) NOT NULL COMMENT '请求路径',
  `request_params` JSON DEFAULT NULL COMMENT '脱敏后的请求参数',
  `operation_result` TINYINT NOT NULL COMMENT '操作结果：0-失败，1-成功',
  `error_message` TEXT DEFAULT NULL COMMENT '错误信息',
  `operated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '操作时间',
  PRIMARY KEY (`id`),
  KEY `idx_operation_logs_operator_operated_at` (`operator_id`, `operated_at`),
  KEY `idx_operation_logs_module_type_operated_at` (`module_code`, `operation_type`, `operated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='操作日志表';

DROP TABLE IF EXISTS `exception_logs`;
CREATE TABLE `exception_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `request_path` VARCHAR(255) NOT NULL COMMENT '接口路径',
  `request_method` VARCHAR(16) NOT NULL COMMENT '请求方法',
  `error_type` VARCHAR(128) NOT NULL COMMENT '错误类型',
  `error_message` TEXT NOT NULL COMMENT '错误信息',
  `stack_summary` TEXT DEFAULT NULL COMMENT '堆栈摘要',
  `handled_status` TINYINT NOT NULL DEFAULT 0 COMMENT '处理状态：0-未处理，1-已处理',
  `occurred_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '发生时间',
  PRIMARY KEY (`id`),
  KEY `idx_exception_logs_handled_occurred_at` (`handled_status`, `occurred_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='异常日志表';

SET FOREIGN_KEY_CHECKS = 1;

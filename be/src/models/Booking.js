import { DataTypes, Model } from 'sequelize';

class Booking extends Model {
  static init(sequelize) {
    return super.init({
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      checkInDate: {
        type: DataTypes.DATE,
        allowNull: false
      },
      checkOutDate: {
        type: DataTypes.DATE,
        allowNull: false
      },
      totalAmount: {
        type: DataTypes.FLOAT,
        allowNull: true
      },
      paymentStatus: {
        type: DataTypes.STRING,
        allowNull: true
      },
      roomType: {
        type: DataTypes.STRING,
        allowNull: true
      },
      numGuests: {
        type: DataTypes.INTEGER,
        allowNull: true
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
      },
      createdBy: {
        type: DataTypes.INTEGER,
        allowNull: true
      },
      updatedBy: {
        type: DataTypes.INTEGER,
        allowNull: true
      }
    }, {
      sequelize,
      modelName: 'Booking',
      tableName: 'bookings',
    });
  }

  static associate(models) {
    this.belongsTo(models.Guest, {
      foreignKey: 'guestId',
      as: 'bookingGuests'
    });
    this.belongsTo(models.Channel, {
      foreignKey: 'channelId',
      as: 'bookingChannels'
    });
  }
}

export default Booking;

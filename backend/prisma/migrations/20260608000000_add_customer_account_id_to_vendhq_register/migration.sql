-- AlterTable: add customerAccountId column to VendhqRegister
-- Stores the Oracle CUST_ACCOUNT_ID (e.g. 300000158776674) for the customer
-- associated with this store/register.  Used by lookupCustomerPartyId as a
-- reliable fallback when Oracle REST is unavailable.  Gets auto-populated on
-- first successful Oracle REST resolution.
ALTER TABLE "VendhqRegister" ADD COLUMN "customerAccountId" TEXT;

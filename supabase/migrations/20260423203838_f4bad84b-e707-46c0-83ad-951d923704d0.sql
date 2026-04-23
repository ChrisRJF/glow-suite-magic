ALTER TABLE public.webshop_orders
ADD COLUMN IF NOT EXISTS stock_processed_at timestamptz NULL;

CREATE OR REPLACE FUNCTION public.process_paid_webshop_order_stock(_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _order public.webshop_orders%ROWTYPE;
  _item jsonb;
  _product_id uuid;
  _qty integer;
  _current_stock integer;
BEGIN
  SELECT * INTO _order
  FROM public.webshop_orders
  WHERE id = _order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF _order.payment_status <> 'paid' OR _order.stock_processed_at IS NOT NULL THEN
    RETURN false;
  END IF;

  FOR _item IN SELECT * FROM jsonb_array_elements(_order.items)
  LOOP
    _product_id := (_item->>'product_id')::uuid;
    _qty := COALESCE((_item->>'quantity')::integer, 0);

    SELECT COALESCE(stock, 0) INTO _current_stock
    FROM public.products
    WHERE id = _product_id AND user_id = _order.user_id
    FOR UPDATE;

    IF _current_stock < _qty THEN
      RAISE EXCEPTION 'Onvoldoende voorraad voor product %', _product_id;
    END IF;

    UPDATE public.products
    SET stock = _current_stock - _qty,
        updated_at = now()
    WHERE id = _product_id AND user_id = _order.user_id;
  END LOOP;

  UPDATE public.webshop_orders
  SET stock_processed_at = now(),
      status = 'paid',
      updated_at = now()
  WHERE id = _order_id;

  RETURN true;
END;
$$;